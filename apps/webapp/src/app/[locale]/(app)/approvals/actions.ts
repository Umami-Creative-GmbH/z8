"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, count, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import {
	absenceEntry,
	approvalRequest,
	employee,
	holiday,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { calculateBusinessDays } from "@/lib/absences/date-utils";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import { renderAbsenceRequestApproved, renderAbsenceRequestRejected } from "@/lib/email/render";
import { createLogger } from "@/lib/logger";
import {
	onAbsenceRequestApproved,
	onAbsenceRequestRejected,
	onTimeCorrectionApproved,
	onTimeCorrectionRejected,
} from "@/lib/notifications/triggers";
import { getCurrentEmployee } from "../absences/actions";

const logger = createLogger("ApprovalsActionsEffect");

// =============================================================================
// Types
// =============================================================================

export interface ApprovalWithAbsence {
	id: string;
	entityId: string;
	entityType: string;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	requester: {
		user: {
			name: string;
			email: string;
			image: string | null;
		};
	};
	absence: {
		id: string;
		startDate: Date;
		endDate: Date;
		notes: string | null;
		category: {
			name: string;
			type: string;
			color: string | null;
		};
	};
}

export interface ApprovalWithTimeCorrection {
	id: string;
	entityId: string;
	entityType: string;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	requester: {
		user: {
			name: string;
			email: string;
			image: string | null;
		};
	};
	workPeriod: {
		id: string;
		startTime: Date;
		endTime: Date | null;
		clockInEntry: {
			timestamp: Date;
		};
		clockOutEntry: {
			timestamp: Date;
		} | null;
	};
}

/**
 * Generic approval workflow handler
 * - Supports both absence and time correction approvals
 * - Type-safe error handling
 * - OTEL tracing with business context
 * - Retry logic for email notifications
 */
async function processApproval<T>(
	entityType: "absence_entry" | "time_entry",
	entityId: string,
	action: "approve" | "reject",
	rejectionReason?: string,
	updateEntity?: (
		dbService: any,
		entityId: string,
		currentEmployee: any,
	) => Effect.Effect<T, any, any>,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("approvals");

	const effect = tracer.startActiveSpan(
		`${action}Entity`,
		{
			attributes: {
				"approval.entity_type": entityType,
				"approval.entity_id": entityId,
				"approval.action": action,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Step 1: Get current employee (the approver)
				const currentEmployee = yield* _(
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

				span.setAttribute("user.id", session.user.id);
				span.setAttribute("approver.id", currentEmployee.id);

				// Step 2: Verify approval request exists and belongs to this approver
				const approval = yield* _(
					dbService.query("getApprovalRequest", async () => {
						return await dbService.db.query.approvalRequest.findFirst({
							where: and(
								eq(approvalRequest.entityType, entityType),
								eq(approvalRequest.entityId, entityId),
								eq(approvalRequest.approverId, currentEmployee.id),
								eq(approvalRequest.status, "pending"),
							),
						});
					}),
					Effect.flatMap((req) =>
						req
							? Effect.succeed(req)
							: Effect.fail(
									new AuthorizationError({
										message: "Approval request not found, already processed, or you are not the approver",
										userId: currentEmployee.id,
										resource: entityType,
										action: action,
									}),
							  ),
					),
				);

				logger.info(
					{
						approverId: currentEmployee.id,
						entityType,
						entityId,
						action,
					},
					"Processing approval action",
				);

				// Step 3: Update approval request status
				yield* _(
					dbService.query("updateApprovalStatus", async () => {
						return await dbService.db
							.update(approvalRequest)
							.set({
								status: action === "approve" ? "approved" : "rejected",
								approvedAt: action === "approve" ? currentTimestamp() : undefined,
								rejectionReason: action === "reject" ? rejectionReason : undefined,
								updatedAt: currentTimestamp(),
							})
							.where(eq(approvalRequest.id, approval.id));
					}),
				);

				// Step 4: Run entity-specific logic (like updating absence status and sending emails)
				if (updateEntity) {
					yield* _(updateEntity(dbService, entityId, currentEmployee));
				}

				logger.info(
					{
						approvalId: approval.id,
						entityType,
						entityId,
						action,
					},
					`Successfully ${action === "approve" ? "approved" : "rejected"} ${entityType}`,
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});

						logger.error({ error, entityType, entityId, action }, "Failed to process approval");
						return yield* _(Effect.fail(error as any));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect as any);
}

/**
 * Approve an absence request
 */
export async function approveAbsenceEffect(absenceId: string): Promise<ServerActionResult<void>> {
	return processApproval(
		"absence_entry",
		absenceId,
		"approve",
		undefined,
		(dbService, entityId, currentEmployee) =>
			Effect.gen(function* (_) {
				const emailService = yield* _(EmailService);

				// Update absence status
				const absence: any = yield* _(
					dbService.query("updateAbsenceStatus", async () => {
						await dbService.db
							.update(absenceEntry)
							.set({
								status: "approved",
								approvedAt: currentTimestamp(),
								approvedBy: currentEmployee.id,
							})
							.where(eq(absenceEntry.id, entityId));

						return await dbService.db.query.absenceEntry.findFirst({
							where: eq(absenceEntry.id, entityId),
							with: {
								category: true,
								employee: { with: { user: true } },
							},
						});
					}),
					Effect.flatMap((a: any) =>
						a
							? Effect.succeed(a)
							: Effect.fail(
									new NotFoundError({
										message: "Absence not found",
										entityType: "absence_entry",
									}),
							  ),
					),
				);

				// Fetch holidays to calculate business days
				const holidays: any = yield* _(
					dbService.query("getHolidays", async () => {
						return await dbService.db.query.holiday.findMany({
							where: eq(holiday.organizationId, absence.employee.organizationId),
						});
					}),
				);

				const days = calculateBusinessDays(absence.startDate, absence.endDate, holidays);
				const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

				const formatDate = (date: Date) =>
					date.toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
					});

				const html = yield* _(
					Effect.promise(() =>
						renderAbsenceRequestApproved({
							employeeName: absence.employee.user.name,
							approverName: currentEmployee.user.name,
							startDate: formatDate(absence.startDate),
							endDate: formatDate(absence.endDate),
							absenceType: absence.category.name,
							days,
							appUrl,
						}),
					),
				);

				yield* _(
					emailService.send({
						to: absence.employee.user.email,
						subject: `Absence Request Approved: ${absence.category.name}`,
						html,
					}),
				);

				// Trigger in-app notification (fire-and-forget)
				void onAbsenceRequestApproved({
					absenceId: entityId,
					employeeUserId: absence.employee.userId,
					employeeName: absence.employee.user.name,
					organizationId: absence.employee.organizationId,
					categoryName: absence.category.name,
					startDate: absence.startDate,
					endDate: absence.endDate,
					approverName: currentEmployee.user.name,
				});

				return absence;
			}),
	);
}

/**
 * Reject an absence request
 */
export async function rejectAbsenceEffect(
	absenceId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	return processApproval(
		"absence_entry",
		absenceId,
		"reject",
		reason,
		(dbService, entityId, currentEmployee) =>
			Effect.gen(function* (_) {
				const emailService = yield* _(EmailService);

				// Update absence status
				const absence: any = yield* _(
					dbService.query("updateAbsenceStatus", async () => {
						await dbService.db
							.update(absenceEntry)
							.set({
								status: "rejected",
								rejectionReason: reason,
							})
							.where(eq(absenceEntry.id, entityId));

						return await dbService.db.query.absenceEntry.findFirst({
							where: eq(absenceEntry.id, entityId),
							with: {
								category: true,
								employee: { with: { user: true } },
							},
						});
					}),
					Effect.flatMap((a: any) =>
						a
							? Effect.succeed(a)
							: Effect.fail(
									new NotFoundError({
										message: "Absence not found",
										entityType: "absence_entry",
									}),
							  ),
					),
				);

				// Fetch holidays to calculate business days
				const holidays: any = yield* _(
					dbService.query("getHolidays", async () => {
						return await dbService.db.query.holiday.findMany({
							where: eq(holiday.organizationId, absence.employee.organizationId),
						});
					}),
				);

				const days = calculateBusinessDays(absence.startDate, absence.endDate, holidays);
				const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

				const formatDate = (date: Date) =>
					date.toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
					});

				const html = yield* _(
					Effect.promise(() =>
						renderAbsenceRequestRejected({
							employeeName: absence.employee.user.name,
							approverName: currentEmployee.user.name,
							startDate: formatDate(absence.startDate),
							endDate: formatDate(absence.endDate),
							absenceType: absence.category.name,
							days,
							rejectionReason: reason,
							appUrl,
						}),
					),
				);

				yield* _(
					emailService.send({
						to: absence.employee.user.email,
						subject: `Absence Request Rejected: ${absence.category.name}`,
						html,
					}),
				);

				// Trigger in-app notification (fire-and-forget)
				void onAbsenceRequestRejected({
					absenceId: entityId,
					employeeUserId: absence.employee.userId,
					employeeName: absence.employee.user.name,
					organizationId: absence.employee.organizationId,
					categoryName: absence.category.name,
					startDate: absence.startDate,
					endDate: absence.endDate,
					approverName: currentEmployee.user.name,
					rejectionReason: reason,
				});

				return absence;
			}),
	);
}

/**
 * Approve a time correction request
 */
export async function approveTimeCorrectionEffect(
	workPeriodId: string,
): Promise<ServerActionResult<void>> {
	return processApproval(
		"time_entry",
		workPeriodId,
		"approve",
		undefined,
		(dbService, entityId, currentEmployee) =>
			Effect.gen(function* (_) {
				// Get the work period with employee info
				const period: any = yield* _(
					dbService.query("getWorkPeriod", async () => {
						return await dbService.db.query.workPeriod.findFirst({
							where: eq(workPeriod.id, entityId),
							with: {
								employee: {
									with: { user: true },
								},
							},
						});
					}),
					Effect.flatMap((p: any) =>
						p
							? Effect.succeed(p)
							: Effect.fail(
									new NotFoundError({ message: "Work period not found", entityType: "work_period" }),
							  ),
					),
				);

				// Find the correction entries (entries that replace the current clock in/out)
				const correctionEntries: any = yield* _(
					dbService.query("getCorrectionEntries", async () => {
						return await dbService.db
							.select()
							.from(timeEntry)
							.where(
								and(
									eq(timeEntry.type, "correction"),
									eq(timeEntry.employeeId, period.employeeId),
									eq(timeEntry.replacesEntryId, period.clockInId),
								),
							);
					}),
				);

				// Re-fetch more precisely if needed, but for now we'll use the simplified logic from original
				const clockInCorrection = correctionEntries.find(
					(e: any) => e.replacesEntryId === period.clockInId,
				);
				const clockOutCorrection: any = yield* _(
					dbService.query("getClockOutCorrection", async () => {
						if (!period.clockOutId) return null;
						return await dbService.db.query.timeEntry.findFirst({
							where: and(
								eq(timeEntry.type, "correction"),
								eq(timeEntry.replacesEntryId, period.clockOutId),
							),
						});
					}),
				);

				if (!clockInCorrection) {
					return yield* _(Effect.fail(new Error("Clock in correction not found")));
				}

				// Calculate new duration
				let durationMinutes = null;
				let endTime = period.endTime;

				if (clockOutCorrection) {
					const durationMs =
						clockOutCorrection.timestamp.getTime() - clockInCorrection.timestamp.getTime();
					durationMinutes = Math.floor(durationMs / 60000);
					endTime = clockOutCorrection.timestamp;
				} else if (period.endTime) {
					const durationMs = period.endTime.getTime() - clockInCorrection.timestamp.getTime();
					durationMinutes = Math.floor(durationMs / 60000);
				}

				// Update work period with corrected entry IDs and times
				yield* _(
					dbService.query("applyTimeCorrection", async () => {
						await dbService.db
							.update(workPeriod)
							.set({
								clockInId: clockInCorrection.id,
								clockOutId: clockOutCorrection?.id || period.clockOutId,
								startTime: clockInCorrection.timestamp,
								endTime,
								durationMinutes,
								updatedAt: new Date(),
							})
							.where(eq(workPeriod.id, entityId));
					}),
				);

				// Trigger in-app notification (fire-and-forget)
				void onTimeCorrectionApproved({
					workPeriodId: entityId,
					employeeUserId: period.employee.userId,
					employeeName: period.employee.user.name,
					organizationId: period.employee.organizationId,
					originalTime: period.startTime,
					correctedTime: clockInCorrection.timestamp,
					approverName: currentEmployee.user.name,
				});

				return period;
			}),
	);
}

/**
 * Reject a time correction request
 */
export async function rejectTimeCorrectionEffect(
	workPeriodId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	return processApproval(
		"time_entry",
		workPeriodId,
		"reject",
		reason,
		(dbService, entityId, currentEmployee) =>
			Effect.gen(function* (_) {
				// Get work period with employee info for notification
				const period: any = yield* _(
					dbService.query("getWorkPeriod", async () => {
						return await dbService.db.query.workPeriod.findFirst({
							where: eq(workPeriod.id, entityId),
							with: {
								employee: {
									with: { user: true },
								},
							},
						});
					}),
					Effect.flatMap((p: any) =>
						p
							? Effect.succeed(p)
							: Effect.fail(
									new NotFoundError({ message: "Work period not found", entityType: "work_period" }),
							  ),
					),
				);

				// Trigger in-app notification (fire-and-forget)
				void onTimeCorrectionRejected({
					workPeriodId: entityId,
					employeeUserId: period.employee.userId,
					employeeName: period.employee.user.name,
					organizationId: period.employee.organizationId,
					originalTime: period.startTime,
					correctedTime: period.startTime, // Use original since rejected
					approverName: currentEmployee.user.name,
					rejectionReason: reason,
				});

				return period;
			}),
	);
}

// =============================================================================
// Utility and Data-Fetching Functions
// =============================================================================

/**
 * Get pending approvals for current employee
 */
export async function getPendingApprovals(): Promise<{
	absenceApprovals: ApprovalWithAbsence[];
	timeCorrectionApprovals: ApprovalWithTimeCorrection[];
}> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) return { absenceApprovals: [], timeCorrectionApprovals: [] };

	const pendingRequests = await db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.approverId, currentEmployee.id),
			eq(approvalRequest.status, "pending"),
		),
		with: {
			requester: {
				with: { user: true },
			},
		},
		orderBy: [desc(approvalRequest.createdAt)],
	});

	const absenceApprovals: ApprovalWithAbsence[] = [];
	const timeCorrectionApprovals: ApprovalWithTimeCorrection[] = [];

	for (const request of pendingRequests) {
		if (request.entityType === "absence_entry") {
			const absence = await db.query.absenceEntry.findFirst({
				where: eq(absenceEntry.id, request.entityId),
				with: { category: true },
			});
			if (absence) {
				absenceApprovals.push({
					...request,
					entityType: "absence_entry",
					absence: {
						id: absence.id,
						startDate: absence.startDate,
						endDate: absence.endDate,
						notes: absence.notes,
						category: {
							name: absence.category.name,
							type: absence.category.type,
							color: absence.category.color,
						},
					},
				} as ApprovalWithAbsence);
			}
		} else if (request.entityType === "time_entry") {
			const period = await db.query.workPeriod.findFirst({
				where: eq(workPeriod.id, request.entityId),
				with: {
					clockIn: true,
					clockOut: true,
				},
			});
			if (period && period.clockIn) {
				timeCorrectionApprovals.push({
					...request,
					entityType: "time_entry",
					workPeriod: {
						id: period.id,
						startTime: period.startTime,
						endTime: period.endTime,
						clockInEntry: period.clockIn,
						clockOutEntry: period.clockOut || null,
					},
				} as ApprovalWithTimeCorrection);
			}
		}
	}

	return { absenceApprovals, timeCorrectionApprovals };
}

/**
 * Get pending approval counts for current employee
 */
export async function getPendingApprovalCounts() {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) return { absences: 0, timeCorrections: 0 };

	const counts = await db
		.select({
			type: approvalRequest.entityType,
			count: count(),
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.approverId, currentEmployee.id),
				eq(approvalRequest.status, "pending"),
			),
		)
		.groupBy(approvalRequest.entityType);

	return {
		absences: Number(counts.find((c) => c.type === "absence_entry")?.count) || 0,
		timeCorrections: Number(counts.find((c) => c.type === "time_entry")?.count) || 0,
	};
}

// Re-export Effect functions with cleaner names (backward compatibility)
export const approveAbsence = approveAbsenceEffect;
export const rejectAbsence = rejectAbsenceEffect;
export const approveTimeCorrection = approveTimeCorrectionEffect;
export const rejectTimeCorrection = rejectTimeCorrectionEffect;
export { getCurrentEmployee };

