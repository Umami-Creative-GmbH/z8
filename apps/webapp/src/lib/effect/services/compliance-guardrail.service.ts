import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import {
	complianceException,
	employee,
	workPeriod,
	workPolicyViolation,
	type ComplianceAlert,
	type ComplianceStatus,
	type OvertimeStats,
	type RestPeriodCheckResult,
} from "@/db/schema";
import { type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService, DatabaseServiceLive } from "./database.service";
import { WorkPolicyService, WorkPolicyServiceLive } from "./work-policy.service";

// ============================================
// TYPES
// ============================================

export interface RequestExceptionInput {
	employeeId: string;
	organizationId: string;
	exceptionType: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";
	reason: string;
	plannedDurationMinutes?: number;
	createdBy: string;
}

export interface ExceptionWithDetails {
	id: string;
	exceptionType: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";
	status: "pending" | "approved" | "rejected" | "expired" | "used";
	reason: string;
	plannedDurationMinutes: number | null;
	validFrom: Date;
	validUntil: Date;
	wasUsed: boolean;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		userId: string;
	};
	approver?: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	};
	createdAt: Date;
}

export interface ProactiveAlertsInput {
	employeeId: string;
	currentSessionMinutes: number;
	timezone: string;
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class ComplianceGuardrailService extends Context.Tag("ComplianceGuardrailService")<
	ComplianceGuardrailService,
	{
		/**
		 * Check if employee can clock in (rest period validation)
		 * Returns whether clock-in is allowed, and if not, what enforcement applies
		 */
		readonly checkRestPeriod: (params: {
			employeeId: string;
			timezone: string;
		}) => Effect.Effect<RestPeriodCheckResult, NotFoundError | DatabaseError>;

		/**
		 * Get proactive compliance alerts for ongoing work session
		 * Returns warnings as user approaches limits
		 */
		readonly getProactiveAlerts: (
			input: ProactiveAlertsInput,
		) => Effect.Effect<ComplianceAlert[], NotFoundError | DatabaseError>;

		/**
		 * Get full compliance status including stats and alerts
		 */
		readonly getComplianceStatus: (params: {
			employeeId: string;
			currentSessionMinutes: number;
			timezone: string;
		}) => Effect.Effect<ComplianceStatus, NotFoundError | DatabaseError>;

		/**
		 * Calculate overtime statistics for an employee
		 */
		readonly getOvertimeStats: (params: {
			employeeId: string;
			timezone: string;
		}) => Effect.Effect<OvertimeStats, NotFoundError | DatabaseError>;

		/**
		 * Request a compliance exception (pre-approval)
		 * Returns the exception ID
		 */
		readonly requestException: (
			input: RequestExceptionInput,
		) => Effect.Effect<string, DatabaseError>;

		/**
		 * Check if employee has a valid approved exception for the given type
		 */
		readonly hasValidException: (params: {
			employeeId: string;
			exceptionType: string;
			checkTime?: Date;
		}) => Effect.Effect<{ hasException: boolean; exceptionId?: string }, DatabaseError>;

		/**
		 * Mark an exception as used (when employee clocks in using it)
		 */
		readonly markExceptionAsUsed: (params: {
			exceptionId: string;
			workPeriodId?: string;
			actualDurationMinutes?: number;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Approve an exception request
		 */
		readonly approveException: (params: {
			exceptionId: string;
			approverId: string;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Reject an exception request
		 */
		readonly rejectException: (params: {
			exceptionId: string;
			approverId: string;
			reason?: string;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Get pending exception requests for approval
		 */
		readonly getPendingExceptions: (params: {
			organizationId: string;
			managerId?: string;
		}) => Effect.Effect<ExceptionWithDetails[], DatabaseError>;

		/**
		 * Expire old pre-approval exceptions (for cron job)
		 */
		readonly expireOldExceptions: (
			organizationId?: string,
		) => Effect.Effect<{ expiredCount: number }, DatabaseError>;

		/**
		 * Get employee's own exceptions
		 */
		readonly getMyExceptions: (params: {
			employeeId: string;
			includeExpired?: boolean;
		}) => Effect.Effect<ExceptionWithDetails[], DatabaseError>;
	}
>() {}

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

function calculateAlertSeverity(
	percentOfLimit: number,
	alertThreshold: number,
): "info" | "warning" | "critical" | "violation" {
	if (percentOfLimit >= 100) return "violation";
	if (percentOfLimit >= 95) return "critical";
	if (percentOfLimit >= alertThreshold) return "warning";
	return "info";
}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const ComplianceGuardrailServiceLive = Layer.effect(
	ComplianceGuardrailService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const workPolicyService = yield* _(WorkPolicyService);

		/**
		 * Get last clock-out time for an employee
		 */
		const getLastClockOut = (employeeId: string): Effect.Effect<Date | null, DatabaseError> =>
			dbService.query("getLastClockOut", async () => {
				const [lastPeriod] = await dbService.db
					.select({
						endTime: workPeriod.endTime,
					})
					.from(workPeriod)
					.where(and(eq(workPeriod.employeeId, employeeId), eq(workPeriod.isActive, false)))
					.orderBy(desc(workPeriod.endTime))
					.limit(1);

				return lastPeriod?.endTime ?? null;
			});

		/**
		 * Calculate total worked minutes for a period
		 */
		const getWorkedMinutes = (
			employeeId: string,
			startDate: Date,
			endDate: Date,
		): Effect.Effect<number, DatabaseError> =>
			dbService.query("getWorkedMinutes", async () => {
				const result = await dbService.db
					.select({
						total: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
					})
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.employeeId, employeeId),
							gte(workPeriod.startTime, startDate),
							lte(workPeriod.startTime, endDate),
							eq(workPeriod.isActive, false),
						),
					);

				return Number(result[0]?.total) || 0;
			});

		/**
		 * Internal function to calculate overtime stats
		 */
		const calculateOvertimeStatsInternal = (params: {
			employeeId: string;
			timezone: string;
		}): Effect.Effect<OvertimeStats, NotFoundError | DatabaseError> =>
			Effect.gen(function* (_) {
				const policy = yield* _(workPolicyService.getEffectivePolicy(params.employeeId));

				const now = DateTime.now().setZone(params.timezone);
				const startOfDay = now.startOf("day").toJSDate();
				const endOfDay = now.endOf("day").toJSDate();
				const startOfWeek = now.startOf("week").toJSDate();
				const endOfWeek = now.endOf("week").toJSDate();
				const startOfMonth = now.startOf("month").toJSDate();
				const endOfMonth = now.endOf("month").toJSDate();

				// Get worked minutes for each period
				const [dailyMinutes, weeklyMinutes, monthlyMinutes] = yield* _(
					Effect.all([
						getWorkedMinutes(params.employeeId, startOfDay, endOfDay),
						getWorkedMinutes(params.employeeId, startOfWeek, endOfWeek),
						getWorkedMinutes(params.employeeId, startOfMonth, endOfMonth),
					]),
				);

				const regulation = policy?.regulation;

				return {
					daily: {
						workedMinutes: dailyMinutes,
						thresholdMinutes: regulation?.overtimeDailyThresholdMinutes ?? null,
						overtimeMinutes:
							regulation?.overtimeDailyThresholdMinutes != null
								? Math.max(0, dailyMinutes - regulation.overtimeDailyThresholdMinutes)
								: 0,
						percentOfThreshold:
							regulation?.overtimeDailyThresholdMinutes != null
								? Math.round((dailyMinutes / regulation.overtimeDailyThresholdMinutes) * 100)
								: null,
					},
					weekly: {
						workedMinutes: weeklyMinutes,
						thresholdMinutes: regulation?.overtimeWeeklyThresholdMinutes ?? null,
						overtimeMinutes:
							regulation?.overtimeWeeklyThresholdMinutes != null
								? Math.max(0, weeklyMinutes - regulation.overtimeWeeklyThresholdMinutes)
								: 0,
						percentOfThreshold:
							regulation?.overtimeWeeklyThresholdMinutes != null
								? Math.round((weeklyMinutes / regulation.overtimeWeeklyThresholdMinutes) * 100)
								: null,
					},
					monthly: {
						workedMinutes: monthlyMinutes,
						thresholdMinutes: regulation?.overtimeMonthlyThresholdMinutes ?? null,
						overtimeMinutes:
							regulation?.overtimeMonthlyThresholdMinutes != null
								? Math.max(0, monthlyMinutes - regulation.overtimeMonthlyThresholdMinutes)
								: 0,
						percentOfThreshold:
							regulation?.overtimeMonthlyThresholdMinutes != null
								? Math.round((monthlyMinutes / regulation.overtimeMonthlyThresholdMinutes) * 100)
								: null,
					},
				} satisfies OvertimeStats;
			});

		return ComplianceGuardrailService.of({
			checkRestPeriod: (params) =>
				Effect.gen(function* (_) {
					// Get effective policy for this employee
					const policy = yield* _(workPolicyService.getEffectivePolicy(params.employeeId));

					// If no policy or no rest period requirement, allow clock-in
					if (!policy?.regulation?.minRestPeriodMinutes) {
						return {
							canClockIn: true,
							enforcement: "none",
							violation: null,
							hasValidException: false,
						} satisfies RestPeriodCheckResult;
					}

					const minRestMinutes = policy.regulation.minRestPeriodMinutes;
					const enforcement = policy.regulation.restPeriodEnforcement ?? "warn";

					// Get last clock-out time
					const lastClockOutTime = yield* _(getLastClockOut(params.employeeId));

					// If never clocked out before, allow clock-in
					if (!lastClockOutTime) {
						return {
							canClockIn: true,
							enforcement,
							violation: null,
							hasValidException: false,
						} satisfies RestPeriodCheckResult;
					}

					// Calculate rest period in minutes
					const now = DateTime.now();
					const lastClockOut = DateTime.fromJSDate(lastClockOutTime);
					const restPeriodMinutes = Math.floor(now.diff(lastClockOut, "minutes").minutes);

					// If rest period is satisfied, allow clock-in
					if (restPeriodMinutes >= minRestMinutes) {
						return {
							canClockIn: true,
							enforcement,
							violation: null,
							hasValidException: false,
						} satisfies RestPeriodCheckResult;
					}

					// Check for valid exception
					const exceptionResult = yield* _(
						dbService.query("checkValidException", async () => {
							const [exception] = await dbService.db
								.select({ id: complianceException.id })
								.from(complianceException)
								.where(
									and(
										eq(complianceException.employeeId, params.employeeId),
										eq(complianceException.exceptionType, "rest_period"),
										eq(complianceException.status, "approved"),
										lte(complianceException.validFrom, now.toJSDate()),
										gte(complianceException.validUntil, now.toJSDate()),
										eq(complianceException.wasUsed, false),
									),
								)
								.limit(1);

							return exception;
						}),
					);

					const hasValidException = !!exceptionResult;
					const shortfallMinutes = minRestMinutes - restPeriodMinutes;

					// If there's a valid exception, allow clock-in
					if (hasValidException) {
						const nextAllowedClockIn = lastClockOut.plus({ minutes: minRestMinutes }).toJSDate();
						return {
							canClockIn: true,
							enforcement,
							violation: {
								lastClockOutTime: lastClockOutTime.toISOString(),
								restPeriodMinutes,
								requiredMinutes: minRestMinutes,
								shortfallMinutes,
							},
							hasValidException: true,
							exceptionId: exceptionResult!.id,
							minutesUntilAllowed: shortfallMinutes,
							nextAllowedClockIn,
						} satisfies RestPeriodCheckResult;
					}

					// Calculate when clock-in will be allowed
					const nextAllowedClockIn = lastClockOut.plus({ minutes: minRestMinutes }).toJSDate();

					// No valid exception - check enforcement mode
					return {
						canClockIn: enforcement === "warn" || enforcement === "none",
						enforcement,
						violation: {
							lastClockOutTime: lastClockOutTime.toISOString(),
							restPeriodMinutes,
							requiredMinutes: minRestMinutes,
							shortfallMinutes,
						},
						hasValidException: false,
						minutesUntilAllowed: shortfallMinutes,
						nextAllowedClockIn,
					} satisfies RestPeriodCheckResult;
				}),

			getProactiveAlerts: (input) =>
				Effect.gen(function* (_) {
					const policy = yield* _(workPolicyService.getEffectivePolicy(input.employeeId));

					if (!policy?.regulation) {
						return [];
					}

					const regulation = policy.regulation;
					const alertThreshold = regulation.alertThresholdPercent ?? 80;
					const alerts: ComplianceAlert[] = [];

					// Get overtime stats
					const stats = yield* _(
						calculateOvertimeStatsInternal({
							employeeId: input.employeeId,
							timezone: input.timezone,
						}),
					);

					// Add current session to daily total for accurate real-time alerts
					const totalDailyWithSession = stats.daily.workedMinutes + input.currentSessionMinutes;

					// Check daily overtime threshold
					if (regulation.overtimeDailyThresholdMinutes != null) {
						const percentOfLimit = Math.round(
							(totalDailyWithSession / regulation.overtimeDailyThresholdMinutes) * 100,
						);

						if (percentOfLimit >= alertThreshold) {
							alerts.push({
								alertType: "overtime_daily",
								severity: calculateAlertSeverity(percentOfLimit, alertThreshold),
								message: `Daily overtime: ${formatMinutes(totalDailyWithSession)} of ${formatMinutes(regulation.overtimeDailyThresholdMinutes)} threshold`,
								minutesRemaining: Math.max(
									0,
									regulation.overtimeDailyThresholdMinutes - totalDailyWithSession,
								),
								thresholdMinutes: regulation.overtimeDailyThresholdMinutes,
								currentMinutes: totalDailyWithSession,
								percentOfLimit,
							});
						}
					}

					// Check max daily (hard limit)
					if (regulation.maxDailyMinutes != null) {
						const percentOfLimit = Math.round(
							(totalDailyWithSession / regulation.maxDailyMinutes) * 100,
						);

						if (percentOfLimit >= alertThreshold) {
							alerts.push({
								alertType: "daily_hours",
								severity: calculateAlertSeverity(percentOfLimit, alertThreshold),
								message: `Daily limit: ${formatMinutes(totalDailyWithSession)} of ${formatMinutes(regulation.maxDailyMinutes)} maximum`,
								minutesRemaining: Math.max(0, regulation.maxDailyMinutes - totalDailyWithSession),
								thresholdMinutes: regulation.maxDailyMinutes,
								currentMinutes: totalDailyWithSession,
								percentOfLimit,
							});
						}
					}

					// Check weekly overtime threshold
					const weeklyWithSession = stats.weekly.workedMinutes + input.currentSessionMinutes;
					if (regulation.overtimeWeeklyThresholdMinutes != null) {
						const percentOfLimit = Math.round(
							(weeklyWithSession / regulation.overtimeWeeklyThresholdMinutes) * 100,
						);

						if (percentOfLimit >= alertThreshold) {
							alerts.push({
								alertType: "overtime_weekly",
								severity: calculateAlertSeverity(percentOfLimit, alertThreshold),
								message: `Weekly overtime: ${formatMinutes(weeklyWithSession)} of ${formatMinutes(regulation.overtimeWeeklyThresholdMinutes)} threshold`,
								minutesRemaining: Math.max(
									0,
									regulation.overtimeWeeklyThresholdMinutes - weeklyWithSession,
								),
								thresholdMinutes: regulation.overtimeWeeklyThresholdMinutes,
								currentMinutes: weeklyWithSession,
								percentOfLimit,
							});
						}
					}

					// Check max uninterrupted
					if (regulation.maxUninterruptedMinutes != null) {
						const percentOfLimit = Math.round(
							(input.currentSessionMinutes / regulation.maxUninterruptedMinutes) * 100,
						);

						if (percentOfLimit >= alertThreshold) {
							alerts.push({
								alertType: "uninterrupted_work",
								severity: calculateAlertSeverity(percentOfLimit, alertThreshold),
								message: `Continuous work: ${formatMinutes(input.currentSessionMinutes)} of ${formatMinutes(regulation.maxUninterruptedMinutes)} maximum`,
								minutesRemaining: Math.max(
									0,
									regulation.maxUninterruptedMinutes - input.currentSessionMinutes,
								),
								thresholdMinutes: regulation.maxUninterruptedMinutes,
								currentMinutes: input.currentSessionMinutes,
								percentOfLimit,
							});
						}
					}

					// Sort alerts by severity (most severe first)
					const severityOrder = { violation: 0, critical: 1, warning: 2, info: 3 };
					alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

					return alerts;
				}),

			getComplianceStatus: (params) =>
				Effect.gen(function* (_) {
					// Get policy for alerts
					const policy = yield* _(workPolicyService.getEffectivePolicy(params.employeeId));

					let alerts: ComplianceAlert[] = [];

					// Get overtime stats
					const stats = yield* _(
						calculateOvertimeStatsInternal({
							employeeId: params.employeeId,
							timezone: params.timezone,
						}),
					);

					// Calculate alerts if we have a regulation
					if (policy?.regulation) {
						const regulation = policy.regulation;
						const alertThreshold = regulation.alertThresholdPercent ?? 80;
						const totalDailyWithSession = stats.daily.workedMinutes + params.currentSessionMinutes;

						// Check daily overtime threshold
						if (regulation.overtimeDailyThresholdMinutes != null) {
							const percentOfLimit = Math.round(
								(totalDailyWithSession / regulation.overtimeDailyThresholdMinutes) * 100,
							);
							if (percentOfLimit >= alertThreshold) {
								alerts.push({
									alertType: "overtime_daily",
									severity: calculateAlertSeverity(percentOfLimit, alertThreshold),
									message: `Daily overtime: ${formatMinutes(totalDailyWithSession)} of ${formatMinutes(regulation.overtimeDailyThresholdMinutes)} threshold`,
									minutesRemaining: Math.max(0, regulation.overtimeDailyThresholdMinutes - totalDailyWithSession),
									thresholdMinutes: regulation.overtimeDailyThresholdMinutes,
									currentMinutes: totalDailyWithSession,
									percentOfLimit,
									canRequestException: true,
								});
							}
						}
					}

					// Get pending exceptions count
					const pendingCount = yield* _(
						dbService.query("getPendingExceptionsCount", async () => {
							const result = await dbService.db
								.select({ count: sql<number>`COUNT(*)` })
								.from(complianceException)
								.where(
									and(
										eq(complianceException.employeeId, params.employeeId),
										eq(complianceException.status, "pending"),
									),
								);

							return Number(result[0]?.count) || 0;
						}),
					);

					// Get unacknowledged violations count
					const violationsCount = yield* _(
						dbService.query("getUnacknowledgedViolationsCount", async () => {
							const emp = await dbService.db.query.employee.findFirst({
								where: eq(employee.id, params.employeeId),
								columns: { organizationId: true },
							});

							if (!emp) return 0;

							const result = await dbService.db
								.select({ count: sql<number>`COUNT(*)` })
								.from(workPolicyViolation)
								.where(
									and(
										eq(workPolicyViolation.employeeId, params.employeeId),
										eq(workPolicyViolation.organizationId, emp.organizationId),
										sql`${workPolicyViolation.acknowledgedAt} IS NULL`,
									),
								);

							return Number(result[0]?.count) || 0;
						}),
					);

					const hasViolation = alerts.some((a) => a.severity === "violation");

					return {
						isCompliant: !hasViolation,
						alerts,
						stats,
						pendingExceptions: pendingCount,
						unacknowledgedViolations: violationsCount,
					} satisfies ComplianceStatus;
				}),

			getOvertimeStats: (params) => calculateOvertimeStatsInternal(params),

			requestException: (input) =>
				Effect.gen(function* (_) {
					const now = DateTime.now();
					const validFrom = now.toJSDate();
					const validUntil = now.plus({ hours: 24 }).toJSDate();

					const [newException] = yield* _(
						dbService.query("createException", async () => {
							return await dbService.db
								.insert(complianceException)
								.values({
									organizationId: input.organizationId,
									employeeId: input.employeeId,
									exceptionType: input.exceptionType,
									status: "pending",
									reason: input.reason,
									plannedDurationMinutes: input.plannedDurationMinutes,
									validFrom,
									validUntil,
									createdBy: input.createdBy,
								})
								.returning({ id: complianceException.id });
						}),
					);

					return newException.id;
				}),

			hasValidException: (params) =>
				dbService.query("hasValidException", async () => {
					const checkTime = params.checkTime ?? new Date();

					const [exception] = await dbService.db
						.select({ id: complianceException.id })
						.from(complianceException)
						.where(
							and(
								eq(complianceException.employeeId, params.employeeId),
								eq(
									complianceException.exceptionType,
									params.exceptionType as
										| "rest_period"
										| "overtime_daily"
										| "overtime_weekly"
										| "overtime_monthly",
								),
								eq(complianceException.status, "approved"),
								lte(complianceException.validFrom, checkTime),
								gte(complianceException.validUntil, checkTime),
								eq(complianceException.wasUsed, false),
							),
						)
						.limit(1);

					return {
						hasException: !!exception,
						exceptionId: exception?.id,
					};
				}),

			markExceptionAsUsed: (params) =>
				Effect.gen(function* (_) {
					const updated = yield* _(
						dbService.query("markExceptionUsed", async () => {
							const result = await dbService.db
								.update(complianceException)
								.set({
									wasUsed: true,
									usedAt: new Date(),
									workPeriodId: params.workPeriodId,
									actualDurationMinutes: params.actualDurationMinutes,
								})
								.where(eq(complianceException.id, params.exceptionId))
								.returning({ id: complianceException.id });

							return result.length > 0;
						}),
					);

					if (!updated) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Exception not found",
									entityType: "complianceException",
									entityId: params.exceptionId,
								}),
							),
						);
					}
				}),

			approveException: (params) =>
				Effect.gen(function* (_) {
					const updated = yield* _(
						dbService.query("approveException", async () => {
							const result = await dbService.db
								.update(complianceException)
								.set({
									status: "approved",
									approverId: params.approverId,
									approvedAt: new Date(),
								})
								.where(
									and(
										eq(complianceException.id, params.exceptionId),
										eq(complianceException.status, "pending"),
									),
								)
								.returning({ id: complianceException.id });

							return result.length > 0;
						}),
					);

					if (!updated) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Exception not found or already processed",
									entityType: "complianceException",
									entityId: params.exceptionId,
								}),
							),
						);
					}
				}),

			rejectException: (params) =>
				Effect.gen(function* (_) {
					const updated = yield* _(
						dbService.query("rejectException", async () => {
							const result = await dbService.db
								.update(complianceException)
								.set({
									status: "rejected",
									approverId: params.approverId,
									rejectedAt: new Date(),
									rejectionReason: params.reason,
								})
								.where(
									and(
										eq(complianceException.id, params.exceptionId),
										eq(complianceException.status, "pending"),
									),
								)
								.returning({ id: complianceException.id });

							return result.length > 0;
						}),
					);

					if (!updated) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Exception not found or already processed",
									entityType: "complianceException",
									entityId: params.exceptionId,
								}),
							),
						);
					}
				}),

			getPendingExceptions: (params) =>
				dbService.query("getPendingExceptions", async () => {
					const exceptions = await dbService.db.query.complianceException.findMany({
						where: and(
							eq(complianceException.organizationId, params.organizationId),
							eq(complianceException.status, "pending"),
						),
						with: {
							employee: {
								columns: {
									id: true,
									firstName: true,
									lastName: true,
									userId: true,
								},
							},
							approver: {
								columns: {
									id: true,
									firstName: true,
									lastName: true,
								},
							},
						},
						orderBy: [desc(complianceException.createdAt)],
					});

					return exceptions.map((e) => ({
						id: e.id,
						exceptionType: e.exceptionType,
						status: e.status,
						reason: e.reason,
						plannedDurationMinutes: e.plannedDurationMinutes,
						validFrom: e.validFrom,
						validUntil: e.validUntil,
						wasUsed: e.wasUsed,
						employee: e.employee!,
						approver: e.approver ?? undefined,
						createdAt: e.createdAt,
					})) as ExceptionWithDetails[];
				}),

			expireOldExceptions: (organizationId) =>
				dbService.query("expireOldExceptions", async () => {
					const now = new Date();

					const conditions = [
						eq(complianceException.status, "pending"),
						lte(complianceException.validUntil, now),
					];

					if (organizationId) {
						conditions.push(eq(complianceException.organizationId, organizationId));
					}

					const result = await dbService.db
						.update(complianceException)
						.set({ status: "expired" })
						.where(and(...conditions))
						.returning({ id: complianceException.id });

					return { expiredCount: result.length };
				}),

			getMyExceptions: (params) =>
				dbService.query("getMyExceptions", async () => {
					const conditions = [eq(complianceException.employeeId, params.employeeId)];

					if (!params.includeExpired) {
						conditions.push(sql`${complianceException.status} != 'expired'`);
					}

					const exceptions = await dbService.db.query.complianceException.findMany({
						where: and(...conditions),
						with: {
							employee: {
								columns: {
									id: true,
									firstName: true,
									lastName: true,
									userId: true,
								},
							},
							approver: {
								columns: {
									id: true,
									firstName: true,
									lastName: true,
								},
							},
						},
						orderBy: [desc(complianceException.createdAt)],
						limit: 50,
					});

					return exceptions.map((e) => ({
						id: e.id,
						exceptionType: e.exceptionType,
						status: e.status,
						reason: e.reason,
						plannedDurationMinutes: e.plannedDurationMinutes,
						validFrom: e.validFrom,
						validUntil: e.validUntil,
						wasUsed: e.wasUsed,
						employee: e.employee!,
						approver: e.approver ?? undefined,
						createdAt: e.createdAt,
					})) as ExceptionWithDetails[];
				}),
		});
	}),
);

// ============================================
// LAYER DEPENDENCIES
// ============================================

/**
 * Full layer with all dependencies for running compliance guardrail checks
 */
export const ComplianceGuardrailServiceFullLive = ComplianceGuardrailServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);
