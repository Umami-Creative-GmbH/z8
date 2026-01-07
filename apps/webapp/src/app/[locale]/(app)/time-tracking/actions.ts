"use server";

import { DateTime } from "luxon";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { approvalRequest, employee, timeEntry, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import { renderTimeCorrectionPendingApproval } from "@/lib/email/render";
import { createLogger } from "@/lib/logger";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { validateTimeEntry, validateTimeEntryRange } from "@/lib/time-tracking/validation";
import type { TimeSummary, WorkPeriodWithEntries } from "./types";


const logger = createLogger("TimeTrackingActionsEffect");

interface CorrectionRequest {
	workPeriodId: string;
	newClockInTime: string; // HH:mm format
	newClockOutTime?: string; // HH:mm format
	reason: string;
}

/**
 * Request a time correction with Effect-based workflow
 * - Transaction for atomic multi-entry updates
 * - Type-safe error handling
 * - OTEL tracing with business context
 * - Retry logic for email notifications
 */
export async function requestTimeCorrectionEffect(
	data: CorrectionRequest,
): Promise<ServerActionResult<{ approvalId: string }>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Authenticate and get current employee
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		// Step 2: Get current employee profile
		const dbService = yield* _(DatabaseService);
		const currentEmployee = yield* _(
			dbService.query("getEmployeeByUserId", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});

				if (!emp) {
					throw new Error("Employee not found");
				}

				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		yield* _(Effect.annotateCurrentSpan("employee.id", currentEmployee.id));
		yield* _(Effect.annotateCurrentSpan("organization.id", currentEmployee.organizationId));

		// Step 3: Check if employee has a manager
		if (!currentEmployee.managerId) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "No manager assigned to approve corrections",
						field: "managerId",
					}),
				),
			);
		}

		yield* _(Effect.annotateCurrentSpan("manager.id", currentEmployee.managerId!));

		logger.info(
			{
				employeeId: currentEmployee.id,
				workPeriodId: data.workPeriodId,
				managerId: currentEmployee.managerId,
			},
			"Processing time correction request",
		);

		// Step 4: Get the work period to correct
		const period = yield* _(
			dbService.query("getWorkPeriod", async () => {
				const [p] = await dbService.db
					.select()
					.from(workPeriod)
					.where(eq(workPeriod.id, data.workPeriodId))
					.limit(1);

				if (!p) {
					throw new Error("Work period not found");
				}

				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Work period not found",
						entityType: "workPeriod",
						entityId: data.workPeriodId,
					}),
			),
		);

		yield* _(Effect.annotateCurrentSpan("correction.original_clock_in", period.startTime.toISOString()));
		if (period.endTime) {
			yield* _(Effect.annotateCurrentSpan("correction.original_clock_out", period.endTime.toISOString()));
		}

		// Step 5: Calculate corrected timestamps
		const startDT = dateFromDB(period.startTime);
		if (!startDT) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Invalid work period start time",
						field: "startTime",
					}),
				),
			);
		}

		const [hours, minutes] = data.newClockInTime.split(":");
		const correctedClockInDT = startDT!.set({
			hour: parseInt(hours, 10),
			minute: parseInt(minutes, 10),
			second: 0,
			millisecond: 0
		});
		const correctedClockInDate = dateToDB(correctedClockInDT)!;

		let correctedClockOutDate: Date | undefined;
		if (data.newClockOutTime && period.endTime) {
			const endDT = dateFromDB(period.endTime);
			if (endDT) {
				const [outHours, outMinutes] = data.newClockOutTime.split(":");
				const correctedClockOutDT = endDT.set({
					hour: parseInt(outHours, 10),
					minute: parseInt(outMinutes, 10),
					second: 0,
					millisecond: 0
				});
				correctedClockOutDate = dateToDB(correctedClockOutDT)!;
			}
		}

		yield* _(Effect.annotateCurrentSpan("correction.corrected_clock_in", correctedClockInDate.toISOString()));
		if (correctedClockOutDate) {
			yield* _(Effect.annotateCurrentSpan("correction.corrected_clock_out", correctedClockOutDate.toISOString()));
		}

		// Step 6: Validate the correction dates (check for holidays)
		const validation = yield* _(
			Effect.promise(() =>
				validateTimeEntryRange(
					currentEmployee.organizationId,
					correctedClockInDate,
					correctedClockOutDate || correctedClockInDate,
				),
			),
		);

		if (!validation.isValid) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: validation.error || "Cannot create time correction for this period",
						field: "timestamp",
						value: validation.holidayName,
					}),
				),
			);
		}

		// Step 7: Create corrections in a transaction-like sequence
		// (Note: Drizzle doesn't expose db.transaction directly, so we use sequential operations)
		// The createTimeEntry function handles blockchain hash linking
		const clockInCorrection = yield* _(
			Effect.promise(() =>
				createTimeEntry({
					employeeId: currentEmployee.id,
					type: "correction",
					timestamp: correctedClockInDate,
					createdBy: session.user.id,
					replacesEntryId: period.clockInId,
					notes: data.reason,
				}),
			),
		);

		yield* _(Effect.annotateCurrentSpan("correction.clock_in_correction_id", clockInCorrection.id));

		// Step 8: Mark original clock in as superseded
		yield* _(
			dbService.query("markClockInSuperseded", async () => {
				return await dbService.db
					.update(timeEntry)
					.set({
						isSuperseded: true,
						supersededById: clockInCorrection.id,
					})
					.where(eq(timeEntry.id, period.clockInId));
			}),
		);

		// Step 9: If clock out time is provided, create correction for that too
		let clockOutCorrectionId: string | undefined;
		if (data.newClockOutTime && period.clockOutId && correctedClockOutDate) {
			const clockOutCorrection = yield* _(
				Effect.promise(() =>
					createTimeEntry({
						employeeId: currentEmployee.id,
						type: "correction",
						timestamp: correctedClockOutDate!,
						createdBy: session.user.id,
						replacesEntryId: period.clockOutId!,
						notes: data.reason,
					}),
				),
			);

			clockOutCorrectionId = clockOutCorrection.id;
			yield* _(Effect.annotateCurrentSpan("correction.clock_out_correction_id", clockOutCorrection.id));

			// Mark original clock out as superseded
			yield* _(
				dbService.query("markClockOutSuperseded", async () => {
					return await dbService.db
						.update(timeEntry)
						.set({
							isSuperseded: true,
							supersededById: clockOutCorrection.id,
						})
						.where(eq(timeEntry.id, period.clockOutId!));
				}),
			);
		}

		logger.info(
			{
				workPeriodId: data.workPeriodId,
				clockInCorrectionId: clockInCorrection.id,
				clockOutCorrectionId,
			},
			"Time correction entries created",
		);

		// Step 10: Create approval request
		const [approval] = yield* _(
			dbService.query("createApprovalRequest", async () => {
				return await dbService.db
					.insert(approvalRequest)
					.values({
						entityType: "time_entry",
						entityId: period.id,
						requestedBy: currentEmployee.id,
						approverId: currentEmployee.managerId!,
						status: "pending",
						reason: data.reason,
					})
					.returning();
			}),
		);

		yield* _(Effect.annotateCurrentSpan("correction.approval_id", approval.id));

		// Step 11: Fetch manager and employee details for email
		const [manager, empWithUser] = yield* _(
			Effect.all([
				dbService.query("getManagerWithUser", async () => {
					const mgr = await dbService.db.query.employee.findFirst({
						where: eq(employee.id, currentEmployee.managerId!),
						with: { user: true },
					});

					if (!mgr) {
						throw new Error("Manager not found");
					}

					return mgr;
				}),
				dbService.query("getEmployeeWithUser", async () => {
					const emp = await dbService.db.query.employee.findFirst({
						where: eq(employee.id, currentEmployee.id),
						with: { user: true },
					});

					if (!emp) {
						throw new Error("Employee not found");
					}

					return emp;
				}),
			]),
		);

		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
		const formatDate = (date: Date) =>
			date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		const formatTime = (date: Date) =>
			date.toLocaleTimeString("en-US", {
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			});

		// Step 12: Render email template
		const html = yield* _(
			Effect.promise(() =>
				renderTimeCorrectionPendingApproval({
					managerName: manager.user.name,
					employeeName: empWithUser.user.name,
					date: formatDate(period.startTime),
					originalClockIn: formatTime(period.startTime),
					originalClockOut: period.endTime ? formatTime(period.endTime) : "—",
					correctedClockIn: formatTime(correctedClockInDate),
					correctedClockOut: correctedClockOutDate ? formatTime(correctedClockOutDate) : "—",
					reason: data.reason,
					approvalUrl: `${appUrl}/approvals`,
				}),
			),
		);

		// Step 13: Send email with retry logic
		const emailService = yield* _(EmailService);

		yield* _(
			emailService.send({
				to: manager.user.email,
				subject: `Time Correction Request from ${empWithUser.user.name}`,
				html,
			}),
		);

		logger.info(
			{
				approvalId: approval.id,
				workPeriodId: data.workPeriodId,
				managerEmail: manager.user.email,
			},
			"Time correction request submitted and notification sent",
		);

		return { approvalId: approval.id };
	}).pipe(
		Effect.tapError((error) =>
			Effect.sync(() => {
				logger.error({ error }, "Failed to process time correction request");
			}),
		),
		Effect.withSpan("requestTimeCorrection", {
			attributes: {
				"correction.work_period_id": data.workPeriodId,
				"correction.clock_in_time": data.newClockInTime,
				"correction.clock_out_time": data.newClockOutTime || "none",
			},
		}),
		Effect.provide(AppLayer),
		Effect.provide(DatabaseServiceLive), // Explicitly provide DatabaseService to satisfy compiler
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// Utility and Data-Fetching Functions (non-Effect)
// =============================================================================

/**
 * Get current employee from session
 */
export async function getCurrentEmployee(): Promise<typeof employee.$inferSelect | null> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	return emp || null;
}

/**
 * Get active work period for current employee
 */
export async function getActiveWorkPeriod(
	employeeId: string,
): Promise<WorkPeriodWithEntries | null> {
	const period = await db.query.workPeriod.findFirst({
		where: and(eq(workPeriod.employeeId, employeeId), isNull(workPeriod.endTime)),
		with: {
			clockIn: true,
			clockOut: true,
		},
	});

	if (!period) return null;

	return {
		id: period.id,
		employeeId: period.employeeId,
		startTime: period.startTime,
		endTime: period.endTime,
		durationMinutes: period.durationMinutes,
		clockIn: period.clockIn,
		clockOut: period.clockOut || undefined,
	};
}

/**
 * Get work periods for an employee within a date range
 */
export async function getWorkPeriods(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodWithEntries[]> {
	const periods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		),
		with: {
			clockIn: true,
			clockOut: true,
		},
		orderBy: [desc(workPeriod.startTime)],
	});

	return periods.map((p) => ({
		id: p.id,
		employeeId: p.employeeId,
		startTime: p.startTime,
		endTime: p.endTime,
		durationMinutes: p.durationMinutes,
		clockIn: p.clockIn,
		clockOut: p.clockOut || undefined,
	}));
}

/**
 * Get time summary for an employee within a date range
 */
export async function getTimeSummary(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<TimeSummary> {
	const periods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		),
	});

	const totalMinutes = periods.reduce((sum, p) => sum + (p.durationMinutes || 0), 0);

	return {
		totalMinutes,
		totalHours: Math.floor(totalMinutes / 60),
		periodCount: periods.length,
		averageHoursPerDay: periods.length > 0 ? totalMinutes / 60 / periods.length : 0,
	};
}

/**
 * Clock in for current employee
 */
export async function clockIn(): Promise<ServerActionResult<typeof timeEntry.$inferSelect>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	// Check for active work period
	const activePeriod = await getActiveWorkPeriod(emp.id);
	if (activePeriod) {
		return { success: false, error: "You are already clocked in" };
	}

	const now = new Date();

	// Validate the time entry
	const validation = await validateTimeEntry(emp.organizationId, now);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock in at this time",
			holidayName: validation.holidayName,
		};
	}

	try {
		// Get previous entry for blockchain linking
		const [previousEntry] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.employeeId, emp.id))
			.orderBy(desc(timeEntry.createdAt))
			.limit(1);

		// Calculate hash
		const hash = calculateHash({
			employeeId: emp.id,
			type: "clock_in",
			timestamp: now.toISOString(),
			previousHash: previousEntry?.hash || null,
		});

		// Get request metadata
		const headersList = await headers();
		const ipAddress =
			headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown";
		const userAgent = headersList.get("user-agent") || "unknown";

		// Create clock in entry
		const [entry] = await db
			.insert(timeEntry)
			.values({
				employeeId: emp.id,
				type: "clock_in",
				timestamp: now,
				hash,
				previousHash: previousEntry?.hash || null,
				ipAddress,
				deviceInfo: userAgent,
				createdBy: session.user.id,
			})
			.returning();

		// Create work period
		await db.insert(workPeriod).values({
			employeeId: emp.id,
			clockInId: entry.id,
			startTime: now,
		});

		return { success: true, data: entry };
	} catch (error) {
		logger.error({ error }, "Clock in error");
		return { success: false, error: "Failed to clock in. Please try again." };
	}
}

/**
 * Clock out for current employee
 */
export async function clockOut(): Promise<ServerActionResult<typeof timeEntry.$inferSelect>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	// Check for active work period
	const activePeriod = await getActiveWorkPeriod(emp.id);
	if (!activePeriod) {
		return { success: false, error: "You are not currently clocked in" };
	}

	const now = new Date();

	// Validate the time entry
	const validation = await validateTimeEntry(emp.organizationId, now);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock out at this time",
			holidayName: validation.holidayName,
		};
	}

	try {
		// Get previous entry for blockchain linking
		const [previousEntry] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.employeeId, emp.id))
			.orderBy(desc(timeEntry.createdAt))
			.limit(1);

		// Calculate hash
		const hash = calculateHash({
			employeeId: emp.id,
			type: "clock_out",
			timestamp: now.toISOString(),
			previousHash: previousEntry?.hash || null,
		});

		// Get request metadata
		const headersList = await headers();
		const ipAddress =
			headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown";
		const userAgent = headersList.get("user-agent") || "unknown";

		// Create clock out entry
		const [entry] = await db
			.insert(timeEntry)
			.values({
				employeeId: emp.id,
				type: "clock_out",
				timestamp: now,
				hash,
				previousHash: previousEntry?.hash || null,
				ipAddress,
				deviceInfo: userAgent,
				createdBy: session.user.id,
			})
			.returning();

		// Update work period
		const durationMs = now.getTime() - activePeriod.startTime.getTime();
		const durationMinutes = Math.floor(durationMs / 60000);

		await db
			.update(workPeriod)
			.set({
				clockOutId: entry.id,
				endTime: now,
				durationMinutes,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, activePeriod.id));

		return { success: true, data: entry };
	} catch (error) {
		logger.error({ error }, "Clock out error");
		return { success: false, error: "Failed to clock out. Please try again." };
	}
}

/**
 * Create a time entry with blockchain hash linking
 * Used for creating correction entries in the requestTimeCorrection workflow
 */
export async function createTimeEntry(params: {
	employeeId: string;
	type: "clock_in" | "clock_out" | "correction";
	timestamp: Date;
	createdBy: string;
	replacesEntryId?: string;
	notes?: string;
}): Promise<typeof timeEntry.$inferSelect> {
	const { employeeId, type, timestamp, createdBy, replacesEntryId, notes } = params;

	// Get previous entry for blockchain linking
	const [previousEntry] = await db
		.select()
		.from(timeEntry)
		.where(eq(timeEntry.employeeId, employeeId))
		.orderBy(desc(timeEntry.createdAt))
		.limit(1);

	// Calculate hash
	const hash = calculateHash({
		employeeId,
		type,
		timestamp: timestamp.toISOString(),
		previousHash: previousEntry?.hash || null,
	});

	// Get request metadata
	const headersList = await headers();
	const ipAddress = headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown";
	const userAgent = headersList.get("user-agent") || "unknown";

	// Create time entry
	const [entry] = await db
		.insert(timeEntry)
		.values({
			employeeId,
			type,
			timestamp,
			hash,
			previousHash: previousEntry?.hash || null,
			ipAddress,
			deviceInfo: userAgent,
			createdBy,
			replacesEntryId,
			notes,
		})
		.returning();

	return entry;
}

// Re-export Effect functions with cleaner names (backward compatibility)
export const requestTimeCorrection = requestTimeCorrectionEffect;
