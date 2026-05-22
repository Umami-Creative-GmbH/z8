"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type {
	ComplianceAlert,
	ComplianceStatus,
	OvertimeStats,
	RestPeriodCheckResult,
} from "@/db/schema";
import { complianceException, employee, employeeManagers, userSettings } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { type AnyAppError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	ComplianceGuardrailService,
	ComplianceGuardrailServiceLive,
	type ExceptionWithDetails,
} from "@/lib/effect/services/compliance-guardrail.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
import { createLogger } from "@/lib/logger";
import {
	onComplianceExceptionApproved,
	onComplianceExceptionRejected,
	onComplianceExceptionRequested,
} from "@/lib/notifications/compliance-triggers";

const logger = createLogger("ComplianceActions");

type EmployeeWithUser = typeof employee.$inferSelect & {
	user: {
		firstName?: string | null;
		lastName?: string | null;
		name: string;
		email?: string | null;
	};
};

type ComplianceExceptionWithEmployee = typeof complianceException.$inferSelect & {
	employee: EmployeeWithUser;
};

// =============================================================================
// Layer composition for compliance service
// =============================================================================

const ComplianceLayer = ComplianceGuardrailServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

// Import Layer from effect
import { Layer } from "effect";

// =============================================================================
// Helper: Get current employee
// =============================================================================

async function getCurrentEmployeeWithTimezone() {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const emp = yield* _(
			dbService.query("getEmployeeByUserId", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
					with: { user: true },
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		// Get user timezone
		const settings = yield* _(
			dbService.query("getUserSettings", async () => {
				return await dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
					columns: { timezone: true },
				});
			}),
		);

		return {
			employee: emp as EmployeeWithUser,
			timezone: settings?.timezone || "UTC",
			userId: session.user.id,
		};
	}).pipe(Effect.provide(AppLayer));

	return Effect.runPromise(effect);
}

function typeEmployeeWithUser<T>(employeeRecord: T) {
	return employeeRecord as T & EmployeeWithUser;
}

function typeComplianceExceptionWithEmployee(exception: unknown) {
	return exception as ComplianceExceptionWithEmployee | undefined;
}

// =============================================================================
// REST PERIOD CHECK
// =============================================================================

/**
 * Check if the current employee can clock in (rest period validation)
 */
export async function checkRestPeriod(): Promise<ServerActionResult<RestPeriodCheckResult>> {
	const tracer = trace.getTracer("compliance");

	const effect = tracer.startActiveSpan("checkRestPeriod", (span) => {
		return Effect.gen(function* (_) {
			const { employee: emp, timezone } = yield* _(
				Effect.tryPromise({
					try: () => getCurrentEmployeeWithTimezone(),
					catch: (e) => e as AnyAppError,
				}),
			);

			span.setAttribute("employee.id", emp.id);

			const complianceService = yield* _(ComplianceGuardrailService);
			const result = yield* _(
				complianceService.checkRestPeriod({
					employeeId: emp.id,
					timezone,
				}),
			);

			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		}).pipe(
			Effect.catchAll((error) =>
				Effect.gen(function* (_) {
					span.recordException(error as Error);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: String(error),
					});
					logger.error({ error }, "Failed to check rest period");
					return yield* _(Effect.fail(error as AnyAppError));
				}),
			),
			Effect.onExit(() => Effect.sync(() => span.end())),
			Effect.provide(ComplianceLayer),
			Effect.provide(AppLayer),
		);
	});

	return runServerActionSafe(effect);
}

// =============================================================================
// PROACTIVE ALERTS
// =============================================================================

/**
 * Get proactive compliance alerts for an ongoing work session
 */
export async function getProactiveAlerts(
	currentSessionMinutes: number,
): Promise<ServerActionResult<ComplianceAlert[]>> {
	const effect = Effect.gen(function* (_) {
		const { employee: emp, timezone } = yield* _(
			Effect.tryPromise({
				try: () => getCurrentEmployeeWithTimezone(),
				catch: (e) => e as AnyAppError,
			}),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(
			complianceService.getProactiveAlerts({
				employeeId: emp.id,
				currentSessionMinutes,
				timezone,
			}),
		);
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// =============================================================================
// COMPLIANCE STATUS
// =============================================================================

/**
 * Get full compliance status including stats and alerts
 */
export async function getComplianceStatus(
	currentSessionMinutes: number,
): Promise<ServerActionResult<ComplianceStatus>> {
	const effect = Effect.gen(function* (_) {
		const { employee: emp, timezone } = yield* _(
			Effect.tryPromise({
				try: () => getCurrentEmployeeWithTimezone(),
				catch: (e) => e as AnyAppError,
			}),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(
			complianceService.getComplianceStatus({
				employeeId: emp.id,
				currentSessionMinutes,
				timezone,
			}),
		);
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// =============================================================================
// OVERTIME STATS
// =============================================================================

/**
 * Get overtime statistics for the current employee
 */
export async function getOvertimeStats(): Promise<ServerActionResult<OvertimeStats>> {
	const effect = Effect.gen(function* (_) {
		const { employee: emp, timezone } = yield* _(
			Effect.tryPromise({
				try: () => getCurrentEmployeeWithTimezone(),
				catch: (e) => e as AnyAppError,
			}),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(
			complianceService.getOvertimeStats({
				employeeId: emp.id,
				timezone,
			}),
		);
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// =============================================================================
// EXCEPTION REQUESTS
// =============================================================================

/**
 * Request a compliance exception (pre-approval)
 */
export async function requestComplianceException(input: {
	exceptionType: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";
	reason: string;
	plannedDurationMinutes?: number;
}): Promise<ServerActionResult<{ exceptionId: string }>> {
	const tracer = trace.getTracer("compliance");

	const effect = tracer.startActiveSpan(
		"requestComplianceException",
		{
			attributes: {
				"exception.type": input.exceptionType,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const { employee: emp, userId } = yield* _(
					Effect.tryPromise({
						try: () => getCurrentEmployeeWithTimezone(),
						catch: (e) => e as AnyAppError,
					}),
				);

				span.setAttribute("employee.id", emp.id);
				span.setAttribute("organization.id", emp.organizationId);

				const dbService = yield* _(DatabaseService);
				const complianceService = yield* _(ComplianceGuardrailService);
				const exceptionId = yield* _(
					complianceService.requestException({
						employeeId: emp.id,
						organizationId: emp.organizationId,
						exceptionType: input.exceptionType,
						reason: input.reason,
						plannedDurationMinutes: input.plannedDurationMinutes,
						createdBy: userId,
					}),
				);
				const primaryManagerLink = yield* _(
					dbService.query("getComplianceExceptionPrimaryManager", async () => {
						return await dbService.db.query.employeeManagers.findFirst({
							where: and(
								eq(employeeManagers.employeeId, emp.id),
								eq(employeeManagers.isPrimary, true),
							),
							columns: { managerId: true },
						});
					}),
				);

				// Trigger notification to manager (fire-and-forget)
				void onComplianceExceptionRequested({
					exceptionId,
					employeeId: emp.id,
					employeeName: buildAuthUserDisplayName(emp.user),
					organizationId: emp.organizationId,
					exceptionType: input.exceptionType,
					reason: input.reason,
					managerId: primaryManagerLink?.managerId,
				});

				logger.info(
					{
						exceptionId,
						employeeId: emp.id,
						exceptionType: input.exceptionType,
					},
					"Compliance exception requested",
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return { exceptionId };
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, input }, "Failed to request compliance exception");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(ComplianceLayer),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Check if the current employee has a valid exception
 */
export async function hasValidException(
	exceptionType: string,
): Promise<ServerActionResult<{ hasException: boolean; exceptionId?: string }>> {
	const effect = Effect.gen(function* (_) {
		const { employee: emp } = yield* _(
			Effect.tryPromise({
				try: () => getCurrentEmployeeWithTimezone(),
				catch: (e) => e as AnyAppError,
			}),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(
			complianceService.hasValidException({
				employeeId: emp.id,
				exceptionType,
			}),
		);
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get the current employee's exceptions
 */
export async function getMyExceptions(
	includeExpired = false,
): Promise<ServerActionResult<ExceptionWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const { employee: emp } = yield* _(
			Effect.tryPromise({
				try: () => getCurrentEmployeeWithTimezone(),
				catch: (e) => e as AnyAppError,
			}),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(
			complianceService.getMyExceptions({
				employeeId: emp.id,
				includeExpired,
			}),
		);
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// =============================================================================
// MANAGER ACTIONS
// =============================================================================

/**
 * Get pending exception requests for the current manager's team
 */
export async function getPendingExceptions(): Promise<ServerActionResult<ExceptionWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const emp = yield* _(
			dbService.query("getEmployeeByUserId", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(
			complianceService.getPendingExceptions({
				organizationId: emp.organizationId,
				managerId: emp.id, // Filter by team manager
			}),
		);
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Approve a compliance exception
 */
export async function approveComplianceException(
	exceptionId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("compliance");

	const effect = tracer.startActiveSpan(
		"approveComplianceException",
		{
			attributes: {
				"exception.id": exceptionId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				const approver = yield* _(
					dbService.query("getApproverEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
							with: { user: true },
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(typeEmployeeWithUser(emp))
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				span.setAttribute("approver.id", approver.id);

				const complianceService = yield* _(ComplianceGuardrailService);
				yield* _(
					complianceService.approveException({
						exceptionId,
						approverId: approver.id,
					}),
				);

				// Get exception details for notification
				const exceptionResult = yield* _(
					dbService.query("getExceptionDetails", async () => {
						return await dbService.db.query.complianceException.findFirst({
							where: eq(complianceException.id, exceptionId),
							with: {
								employee: { with: { user: true } },
							},
						});
					}),
				);
				const exception = typeComplianceExceptionWithEmployee(exceptionResult);

				// Trigger notification (fire-and-forget)
				if (exception) {
					void onComplianceExceptionApproved({
						exceptionId,
						employeeUserId: exception.employee.userId,
						employeeName: buildAuthUserDisplayName(exception.employee.user),
						organizationId: exception.organizationId,
						exceptionType: exception.exceptionType,
						approverName: buildAuthUserDisplayName(approver.user),
						validUntil: exception.validUntil,
					});
				}

				logger.info(
					{
						exceptionId,
						approverId: approver.id,
					},
					"Compliance exception approved",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, exceptionId }, "Failed to approve compliance exception");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(ComplianceLayer),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Reject a compliance exception
 */
export async function rejectComplianceException(
	exceptionId: string,
	reason?: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("compliance");

	const effect = tracer.startActiveSpan(
		"rejectComplianceException",
		{
			attributes: {
				"exception.id": exceptionId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				const approver = yield* _(
					dbService.query("getApproverEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
							with: { user: true },
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(typeEmployeeWithUser(emp))
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				span.setAttribute("approver.id", approver.id);

				// Get exception details before rejection for notification
				const exceptionResult = yield* _(
					dbService.query("getExceptionDetails", async () => {
						return await dbService.db.query.complianceException.findFirst({
							where: eq(complianceException.id, exceptionId),
							with: {
								employee: { with: { user: true } },
							},
						});
					}),
				);
				const exception = typeComplianceExceptionWithEmployee(exceptionResult);

				const complianceService = yield* _(ComplianceGuardrailService);
				yield* _(
					complianceService.rejectException({
						exceptionId,
						approverId: approver.id,
						reason,
					}),
				);

				// Trigger notification (fire-and-forget)
				if (exception) {
					void onComplianceExceptionRejected({
						exceptionId,
						employeeUserId: exception.employee.userId,
						employeeName: buildAuthUserDisplayName(exception.employee.user),
						organizationId: exception.organizationId,
						exceptionType: exception.exceptionType,
						approverName: buildAuthUserDisplayName(approver.user),
						reason,
					});
				}

				logger.info(
					{
						exceptionId,
						approverId: approver.id,
						reason,
					},
					"Compliance exception rejected",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, exceptionId, reason }, "Failed to reject compliance exception");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(ComplianceLayer),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// ADMIN ACTIONS
// =============================================================================

/**
 * Expire old pre-approval exceptions (for cron jobs or admin use)
 */
export async function expireOldExceptions(): Promise<ServerActionResult<{ expiredCount: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get admin's organization
		const emp = yield* _(
			dbService.query("getEmployeeByUserId", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		const complianceService = yield* _(ComplianceGuardrailService);
		return yield* _(complianceService.expireOldExceptions(emp.organizationId));
	}).pipe(Effect.provide(ComplianceLayer), Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
