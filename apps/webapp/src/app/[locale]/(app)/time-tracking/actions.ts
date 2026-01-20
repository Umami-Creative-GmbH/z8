"use server";

import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { db } from "@/db";
import {
	approvalRequest,
	employee,
	project,
	projectAssignment,
	surchargeCalculation,
	timeEntry,
	userSettings,
	workPeriod,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import { SurchargeService, SurchargeServiceLive } from "@/lib/effect/services/surcharge.service";
import {
	TimeRegulationService,
	TimeRegulationServiceLive,
} from "@/lib/effect/services/time-regulation.service";
import {
	BreakEnforcementService,
	BreakEnforcementServiceLive,
	type BreakEnforcementResult,
} from "@/lib/effect/services/break-enforcement.service";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";
import { renderTimeCorrectionPendingApproval } from "@/lib/email/render";
import { createLogger } from "@/lib/logger";
import {
	checkProjectBudgetWarnings,
	getProjectTotalHours,
} from "@/lib/notifications/project-notification-triggers";
import {
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
} from "@/lib/notifications/triggers";
import type { ComplianceWarning } from "@/lib/time-regulations/validation";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { isSameDayInTimezone } from "@/lib/time-tracking/time-utils";
import {
	getMonthRangeInTimezone,
	getTodayRangeInTimezone,
	getWeekRangeInTimezone,
} from "@/lib/time-tracking/timezone-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";
import { validateTimeEntry, validateTimeEntryRange } from "@/lib/time-tracking/validation";
import type { WorkPeriodWithEntries } from "./types";

const logger = createLogger("TimeTrackingActionsEffect");

interface CorrectionRequest {
	workPeriodId: string;
	newClockInTime: string; // HH:mm format
	newClockOutTime?: string; // HH:mm format
	reason: string;
}

interface SameDayEditRequest {
	workPeriodId: string;
	newClockInTime: string; // HH:mm format
	newClockOutTime?: string; // HH:mm format
	reason?: string; // Optional for same-day edits
}

/**
 * Edit a time entry directly when allowed by the change policy
 * Uses the employee's effective change policy to determine if direct edit is allowed
 * or if manager approval is required
 */
export async function editSameDayTimeEntry(
	data: SameDayEditRequest,
): Promise<ServerActionResult<{ workPeriodId: string; requiresApproval?: boolean }>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	// Get employee profile
	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	// Get user's timezone from userSettings
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { timezone: true },
	});
	const timezone = settingsData?.timezone || "UTC";

	// Get the work period
	const [period] = await db
		.select()
		.from(workPeriod)
		.where(eq(workPeriod.id, data.workPeriodId))
		.limit(1);

	if (!period) {
		return { success: false, error: "Work period not found" };
	}

	// Verify ownership
	if (period.employeeId !== emp.id) {
		return { success: false, error: "You can only edit your own time entries" };
	}

	// Verify work period is completed
	if (!period.endTime) {
		return { success: false, error: "Cannot edit an active work period. Please clock out first." };
	}

	// Check edit capability using change policy
	let editCapability: EditCapability;
	try {
		const capabilityEffect = Effect.gen(function* (_) {
			const policyService = yield* _(ChangePolicyService);
			return yield* _(
				policyService.getEditCapability({
					employeeId: emp.id,
					workPeriodEndTime: period.endTime!,
					timezone,
				}),
			);
		}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive));

		editCapability = await Effect.runPromise(capabilityEffect);
	} catch (error) {
		logger.error({ error }, "Failed to check edit capability");
		// Default to legacy same-day check if policy service fails
		if (!isSameDayInTimezone(period.startTime, timezone)) {
			return {
				success: false,
				error: "Past entries require manager approval. Please use the correction request.",
			};
		}
		editCapability = { type: "direct", reason: "within_self_service" };
	}

	// Handle different capabilities
	if (editCapability.type === "forbidden") {
		return {
			success: false,
			error: `Entries older than ${editCapability.daysBack} days can only be edited by admins or team leads.`,
		};
	}

	if (editCapability.type === "approval_required") {
		// For approval_required, redirect to correction request flow
		return {
			success: false,
			error: "This edit requires manager approval. Please use the correction request.",
			requiresApproval: true,
		} as ServerActionResult<{ workPeriodId: string; requiresApproval?: boolean }>;
	}

	// editCapability.type === "direct" - proceed with the edit

	// Calculate corrected timestamps
	// The user provides times in their local timezone, so we need to:
	// 1. Get the date portion in the user's timezone
	// 2. Set the new time in that timezone
	// 3. Convert back to UTC for storage
	const startDT = dateFromDB(period.startTime);
	if (!startDT) {
		return { success: false, error: "Invalid work period start time" };
	}

	// Convert to user's timezone to get the correct date
	const startInUserTz = startDT.setZone(timezone);
	const [hours, minutes] = data.newClockInTime.split(":");
	const correctedClockInDT = startInUserTz
		.set({
			hour: parseInt(hours, 10),
			minute: parseInt(minutes, 10),
			second: 0,
			millisecond: 0,
		})
		.toUTC(); // Convert back to UTC for storage
	const correctedClockInDate = dateToDB(correctedClockInDT)!;

	// Validate: clock in time cannot be in the future
	const now = new Date();
	if (correctedClockInDate > now) {
		return { success: false, error: "Clock in time cannot be in the future" };
	}

	let correctedClockOutDate: Date | undefined;
	if (data.newClockOutTime && period.endTime) {
		const endDT = dateFromDB(period.endTime);
		if (endDT) {
			// Convert to user's timezone to get the correct date
			const endInUserTz = endDT.setZone(timezone);
			const [outHours, outMinutes] = data.newClockOutTime.split(":");
			const correctedClockOutDT = endInUserTz
				.set({
					hour: parseInt(outHours, 10),
					minute: parseInt(outMinutes, 10),
					second: 0,
					millisecond: 0,
				})
				.toUTC(); // Convert back to UTC for storage
			correctedClockOutDate = dateToDB(correctedClockOutDT)!;

			// Validate: clock out time cannot be in the future
			if (correctedClockOutDate > now) {
				return { success: false, error: "Clock out time cannot be in the future" };
			}
		}
	}

	// Validate time span - clock out must be after clock in
	if (correctedClockOutDate && correctedClockOutDate <= correctedClockInDate) {
		return { success: false, error: "Clock out time must be after clock in time" };
	}

	// Validate the correction dates (check for holidays)
	const validation = await validateTimeEntryRange(
		emp.organizationId,
		correctedClockInDate,
		correctedClockOutDate || correctedClockInDate,
	);

	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot update time entry for this period",
			holidayName: validation.holidayName,
		};
	}

	try {
		// Create correction entry for clock in
		const clockInCorrection = await createTimeEntry({
			employeeId: emp.id,
			type: "correction",
			timestamp: correctedClockInDate,
			createdBy: session.user.id,
			replacesEntryId: period.clockInId,
			notes: data.reason || "Same-day edit",
		});

		// Mark original clock in as superseded
		await db
			.update(timeEntry)
			.set({
				isSuperseded: true,
				supersededById: clockInCorrection.id,
			})
			.where(eq(timeEntry.id, period.clockInId));

		// Handle clock out correction if provided
		let clockOutCorrectionId: string | undefined;
		if (data.newClockOutTime && period.clockOutId && correctedClockOutDate) {
			const clockOutCorrection = await createTimeEntry({
				employeeId: emp.id,
				type: "correction",
				timestamp: correctedClockOutDate,
				createdBy: session.user.id,
				replacesEntryId: period.clockOutId,
				notes: data.reason || "Same-day edit",
			});

			clockOutCorrectionId = clockOutCorrection.id;

			// Mark original clock out as superseded
			await db
				.update(timeEntry)
				.set({
					isSuperseded: true,
					supersededById: clockOutCorrection.id,
				})
				.where(eq(timeEntry.id, period.clockOutId));
		} else if (data.reason && period.clockOutId) {
			// Update the clock-out entry's notes even if time wasn't changed
			// This allows users to add descriptions without changing times
			await db
				.update(timeEntry)
				.set({ notes: data.reason })
				.where(eq(timeEntry.id, period.clockOutId));
		}

		// Calculate new duration
		const finalClockOut = correctedClockOutDate || period.endTime;
		const durationMs = finalClockOut.getTime() - correctedClockInDate.getTime();
		const durationMinutes = Math.floor(durationMs / 60000);

		// Update work period with corrected times
		await db
			.update(workPeriod)
			.set({
				clockInId: clockInCorrection.id,
				clockOutId: clockOutCorrectionId || period.clockOutId,
				startTime: correctedClockInDate,
				endTime: correctedClockOutDate || period.endTime,
				durationMinutes,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, period.id));

		logger.info(
			{
				workPeriodId: data.workPeriodId,
				employeeId: emp.id,
				clockInCorrectionId: clockInCorrection.id,
				clockOutCorrectionId,
			},
			"Same-day time entry edited successfully",
		);

		return { success: true, data: { workPeriodId: period.id } };
	} catch (error) {
		logger.error({ error }, "Failed to edit same-day time entry");
		return { success: false, error: "Failed to update time entry. Please try again." };
	}
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

		// Get user's timezone for time conversion from userSettings
		const settingsData = yield* _(
			dbService.query("getUserTimezone", async () => {
				return await dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
					columns: { timezone: true },
				});
			}),
		);
		const timezone = settingsData?.timezone || "UTC";

		logger.info(
			{
				employeeId: currentEmployee.id,
				workPeriodId: data.workPeriodId,
				managerId: currentEmployee.managerId,
				timezone,
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

		yield* _(
			Effect.annotateCurrentSpan("correction.original_clock_in", period.startTime.toISOString()),
		);
		if (period.endTime) {
			yield* _(
				Effect.annotateCurrentSpan("correction.original_clock_out", period.endTime.toISOString()),
			);
		}

		// Step 5: Calculate corrected timestamps
		// The user provides times in their local timezone, so we need to:
		// 1. Get the date portion in the user's timezone
		// 2. Set the new time in that timezone
		// 3. Convert back to UTC for storage
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

		// Convert to user's timezone to get the correct date
		const startInUserTz = startDT!.setZone(timezone);
		const [hours, minutes] = data.newClockInTime.split(":");
		const correctedClockInDT = startInUserTz
			.set({
				hour: parseInt(hours, 10),
				minute: parseInt(minutes, 10),
				second: 0,
				millisecond: 0,
			})
			.toUTC(); // Convert back to UTC for storage
		const correctedClockInDate = dateToDB(correctedClockInDT)!;

		// Validate: clock in time cannot be in the future
		const now = new Date();
		if (correctedClockInDate > now) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Clock in time cannot be in the future",
						field: "newClockInTime",
					}),
				),
			);
		}

		let correctedClockOutDate: Date | undefined;
		if (data.newClockOutTime && period.endTime) {
			const endDT = dateFromDB(period.endTime);
			if (endDT) {
				// Convert to user's timezone to get the correct date
				const endInUserTz = endDT.setZone(timezone);
				const [outHours, outMinutes] = data.newClockOutTime.split(":");
				const correctedClockOutDT = endInUserTz
					.set({
						hour: parseInt(outHours, 10),
						minute: parseInt(outMinutes, 10),
						second: 0,
						millisecond: 0,
					})
					.toUTC(); // Convert back to UTC for storage
				correctedClockOutDate = dateToDB(correctedClockOutDT)!;

				// Validate: clock out time cannot be in the future
				if (correctedClockOutDate > now) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Clock out time cannot be in the future",
								field: "newClockOutTime",
							}),
						),
					);
				}
			}
		}

		yield* _(
			Effect.annotateCurrentSpan(
				"correction.corrected_clock_in",
				correctedClockInDate.toISOString(),
			),
		);
		if (correctedClockOutDate) {
			yield* _(
				Effect.annotateCurrentSpan(
					"correction.corrected_clock_out",
					correctedClockOutDate.toISOString(),
				),
			);
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
			yield* _(
				Effect.annotateCurrentSpan("correction.clock_out_correction_id", clockOutCorrection.id),
			);

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
 * Get time clock status for the current user (used by header popover)
 * Returns clock status without requiring employeeId as parameter
 */
export async function getTimeClockStatus(): Promise<{
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	activeWorkPeriod: { id: string; startTime: Date } | null;
}> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { hasEmployee: false, employeeId: null, isClockedIn: false, activeWorkPeriod: null };
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	if (!emp) {
		return { hasEmployee: false, employeeId: null, isClockedIn: false, activeWorkPeriod: null };
	}

	const period = await db.query.workPeriod.findFirst({
		where: and(eq(workPeriod.employeeId, emp.id), isNull(workPeriod.endTime)),
	});

	return {
		hasEmployee: true,
		employeeId: emp.id,
		isClockedIn: !!period,
		activeWorkPeriod: period ? { id: period.id, startTime: period.startTime } : null,
	};
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
 * Get time summary for an employee (today, week, month)
 * Uses employee's timezone for day/week/month boundaries
 * Includes surcharge credits if surcharges are enabled
 */
export async function getTimeSummary(
	employeeId: string,
	timezone: string = "UTC",
): Promise<TimeSummary> {
	// Use timezone-aware boundaries for accurate day/week/month calculations
	const { start: todayStartDT, end: todayEndDT } = getTodayRangeInTimezone(timezone);
	const { start: weekStartDT, end: weekEndDT } = getWeekRangeInTimezone(new Date(), timezone);
	const { start: monthStartDT, end: monthEndDT } = getMonthRangeInTimezone(new Date(), timezone);

	const todayStart = dateToDB(todayStartDT)!;
	const todayEnd = dateToDB(todayEndDT)!;
	const weekStart = dateToDB(weekStartDT)!;
	const weekEnd = dateToDB(weekEndDT)!;
	const monthStart = dateToDB(monthStartDT)!;
	const monthEnd = dateToDB(monthEndDT)!;

	// Fetch all periods for the month with their surcharge calculations
	const periodsWithSurcharges = await db
		.select({
			id: workPeriod.id,
			startTime: workPeriod.startTime,
			durationMinutes: workPeriod.durationMinutes,
			surchargeMinutes: surchargeCalculation.surchargeMinutes,
		})
		.from(workPeriod)
		.leftJoin(surchargeCalculation, eq(surchargeCalculation.workPeriodId, workPeriod.id))
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
				gte(workPeriod.startTime, monthStart),
				lte(workPeriod.startTime, monthEnd),
			),
		);

	// Calculate base minutes for each time range
	const todayMinutes = periodsWithSurcharges
		.filter((p) => p.startTime >= todayStart && p.startTime <= todayEnd)
		.reduce((sum, p) => sum + (p.durationMinutes || 0), 0);

	const weekMinutes = periodsWithSurcharges
		.filter((p) => p.startTime >= weekStart && p.startTime <= weekEnd)
		.reduce((sum, p) => sum + (p.durationMinutes || 0), 0);

	const monthMinutes = periodsWithSurcharges.reduce((sum, p) => sum + (p.durationMinutes || 0), 0);

	// Calculate surcharge minutes for each time range
	const todaySurchargeMinutes = periodsWithSurcharges
		.filter((p) => p.startTime >= todayStart && p.startTime <= todayEnd)
		.reduce((sum, p) => sum + (p.surchargeMinutes || 0), 0);

	const weekSurchargeMinutes = periodsWithSurcharges
		.filter((p) => p.startTime >= weekStart && p.startTime <= weekEnd)
		.reduce((sum, p) => sum + (p.surchargeMinutes || 0), 0);

	const monthSurchargeMinutes = periodsWithSurcharges.reduce(
		(sum, p) => sum + (p.surchargeMinutes || 0),
		0,
	);

	return {
		todayMinutes,
		weekMinutes,
		monthMinutes,
		// Only include surcharge fields if there are any surcharges
		...(monthSurchargeMinutes > 0 && {
			todaySurchargeMinutes,
			weekSurchargeMinutes,
			monthSurchargeMinutes,
		}),
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

	// Get user's timezone for holiday validation from userSettings
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { timezone: true },
	});
	const timezone = settingsData?.timezone || "UTC";

	// Check for active work period
	const activePeriod = await getActiveWorkPeriod(emp.id);
	if (activePeriod) {
		return { success: false, error: "You are already clocked in" };
	}

	const now = new Date();

	// Validate the time entry (pass timezone for holiday checks)
	const validation = await validateTimeEntry(emp.organizationId, now, timezone);
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
 * Break adjustment info returned when break was auto-enforced
 */
export interface BreakAdjustmentInfo {
	breakMinutes: number;
	breakInsertedAt: string;
	regulationName: string;
	originalDurationMinutes: number;
	adjustedDurationMinutes: number;
}

/**
 * Clock out result type with optional compliance warnings and break adjustment
 */
export type ClockOutResult = typeof timeEntry.$inferSelect & {
	complianceWarnings?: ComplianceWarning[];
	breakAdjustment?: BreakAdjustmentInfo;
	pendingApproval?: boolean;
};

/**
 * Clock out for current employee
 * Also checks compliance against time regulations and logs any violations
 * @param projectId - Optional project ID to assign the work period to
 * @param workCategoryId - Optional work category ID to apply a time factor
 */
export async function clockOut(projectId?: string, workCategoryId?: string): Promise<ServerActionResult<ClockOutResult>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	// Get user's timezone for compliance calculations from userSettings
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { timezone: true },
	});
	const timezone = settingsData?.timezone || "UTC";

	// Check for active work period
	const activePeriod = await getActiveWorkPeriod(emp.id);
	if (!activePeriod) {
		return { success: false, error: "You are not currently clocked in" };
	}

	const now = new Date();

	// Validate the time entry (pass timezone for holiday checks)
	const validation = await validateTimeEntry(emp.organizationId, now, timezone);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock out at this time",
			holidayName: validation.holidayName,
		};
	}

	// Validate project if provided
	if (projectId) {
		const projectValidation = await validateProjectAssignment(projectId, emp.id, emp.teamId);
		if (!projectValidation.isValid) {
			return {
				success: false,
				error: projectValidation.error || "Cannot assign to this project",
			};
		}
	}

	// Check if clock-out needs approval (0-day policy)
	let needsClockOutApproval = false;
	try {
		const checkEffect = Effect.gen(function* (_) {
			const policyService = yield* _(ChangePolicyService);
			return yield* _(policyService.checkClockOutNeedsApproval(emp.id));
		}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive));

		needsClockOutApproval = await Effect.runPromise(checkEffect);
	} catch (error) {
		// Log but don't fail clock-out if policy check fails
		logger.warn({ error }, "Failed to check clock-out approval requirement");
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

		// Determine approval status based on policy
		const approvalStatus = needsClockOutApproval ? "pending" : "approved";

		// Prepare pending changes data if approval is needed
		// Note: Drizzle will serialize this object to JSON for storage
		const pendingChangesData = needsClockOutApproval
			? {
					originalStartTime: activePeriod.startTime.toISOString(),
					originalEndTime: now.toISOString(),
					originalDurationMinutes: durationMinutes,
					requestedAt: now.toISOString(),
					requestedBy: session.user.id,
					isNewClockOut: true,
				}
			: null;

		await db
			.update(workPeriod)
			.set({
				clockOutId: entry.id,
				endTime: now,
				durationMinutes,
				projectId: projectId || null,
				workCategoryId: workCategoryId || null,
				isActive: false,
				approvalStatus,
				pendingChanges: pendingChangesData,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, activePeriod.id));

		// If clock-out needs approval, create an approval request
		if (needsClockOutApproval && emp.managerId) {
			await createClockOutApprovalRequest({
				workPeriodId: activePeriod.id,
				employeeId: emp.id,
				managerId: emp.managerId,
				organizationId: emp.organizationId,
				startTime: activePeriod.startTime,
				endTime: now,
				durationMinutes,
			});
		}

		// Calculate and persist surcharge credits if feature is enabled
		await calculateAndPersistSurcharges(activePeriod.id, emp.organizationId);

		// Check compliance against time regulations
		const complianceWarnings = await checkComplianceAfterClockOut(
			emp.id,
			emp.organizationId,
			activePeriod.id,
			durationMinutes,
			timezone,
		);

		// Check and enforce breaks if needed (auto-adjust for break violations)
		const breakEnforcementResult = await enforceBreaksAfterClockOut({
			employeeId: emp.id,
			organizationId: emp.organizationId,
			workPeriodId: activePeriod.id,
			sessionDurationMinutes: durationMinutes,
			timezone,
			createdBy: session.user.id,
		});

		// Fire-and-forget: Check project budget warnings if project was assigned
		if (projectId) {
			checkProjectBudgetAfterClockOut(projectId, emp.organizationId).catch((err) => {
				logger.error({ error: err, projectId }, "Failed to check project budget warnings");
			});
		}

		return {
			success: true,
			data: {
				...entry,
				complianceWarnings: complianceWarnings.length > 0 ? complianceWarnings : undefined,
				breakAdjustment: breakEnforcementResult.wasAdjusted
					? breakEnforcementResult.adjustment
					: undefined,
				pendingApproval: needsClockOutApproval || undefined,
			},
		};
	} catch (error) {
		logger.error({ error }, "Clock out error");
		return { success: false, error: "Failed to clock out. Please try again." };
	}
}

/**
 * Validate that an employee can assign time to a project
 * Checks: project exists, is bookable (planned/active/paused), employee has access
 */
async function validateProjectAssignment(
	projectId: string,
	employeeId: string,
	teamId: string | null,
): Promise<{ isValid: boolean; error?: string }> {
	// Get the project
	const proj = await db.query.project.findFirst({
		where: eq(project.id, projectId),
	});

	if (!proj) {
		return { isValid: false, error: "Project not found" };
	}

	// Check if project is bookable
	const bookableStatuses = ["planned", "active", "paused"];
	if (!bookableStatuses.includes(proj.status)) {
		return {
			isValid: false,
			error: `Cannot book time to ${proj.status} projects. Project must be planned, active, or paused.`,
		};
	}

	// Check if employee has access to the project
	// Either directly assigned or via team
	const conditions = [
		eq(projectAssignment.projectId, projectId),
		eq(projectAssignment.employeeId, employeeId),
	];

	// Build OR condition for team assignment
	const assignmentQuery = teamId
		? or(
				and(
					eq(projectAssignment.projectId, projectId),
					eq(projectAssignment.employeeId, employeeId),
				),
				and(eq(projectAssignment.projectId, projectId), eq(projectAssignment.teamId, teamId)),
			)
		: and(eq(projectAssignment.projectId, projectId), eq(projectAssignment.employeeId, employeeId));

	const assignment = await db.query.projectAssignment.findFirst({
		where: assignmentQuery,
	});

	if (!assignment) {
		return {
			isValid: false,
			error: "You are not assigned to this project. Contact your administrator.",
		};
	}

	return { isValid: true };
}

/**
 * Check compliance after clocking out and log any violations
 * This is a warning-only system - it logs violations but doesn't block actions
 */
async function checkComplianceAfterClockOut(
	employeeId: string,
	organizationId: string,
	workPeriodId: string,
	currentSessionMinutes: number,
	timezone: string = "UTC",
): Promise<ComplianceWarning[]> {
	try {
		// Get time summary for today and this week using employee's timezone
		const timeSummary = await getTimeSummary(employeeId, timezone);

		// Calculate breaks taken today (gaps between work periods)
		const breaksTaken = await calculateBreaksTakenToday(employeeId, timezone);

		// Use Effect to check compliance
		const complianceEffect = Effect.gen(function* (_) {
			const regulationService = yield* _(TimeRegulationService);

			const result = yield* _(
				regulationService.checkCompliance({
					employeeId,
					currentSessionMinutes,
					totalDailyMinutes: timeSummary.todayMinutes,
					totalWeeklyMinutes: timeSummary.weekMinutes,
					breaksTakenMinutes: breaksTaken,
				}),
			);

			// Log violations if any
			if (result.warnings.length > 0) {
				const effectiveRegulation = yield* _(regulationService.getEffectiveRegulation(employeeId));

				if (effectiveRegulation) {
					for (const warning of result.warnings) {
						if (warning.severity === "violation") {
							yield* _(
								regulationService.logViolation({
									employeeId,
									organizationId,
									regulationId: effectiveRegulation.regulationId,
									workPeriodId,
									violationType: warning.type,
									details: {
										actualMinutes: warning.actualValue,
										limitMinutes: warning.limitValue,
										warningShownAt: new Date().toISOString(),
										userContinued: true,
									},
								}),
							);
						}
					}
				}
			}

			return result.warnings;
		}).pipe(Effect.provide(TimeRegulationServiceLive), Effect.provide(DatabaseServiceLive));

		const warnings = await Effect.runPromise(complianceEffect);
		return warnings;
	} catch (error) {
		// Log the error but don't fail the clock-out
		logger.error({ error }, "Failed to check compliance after clock-out");
		return [];
	}
}

/**
 * Calculate total break minutes taken today (gaps between completed work periods)
 * Uses employee's timezone for "today" calculation
 */
async function calculateBreaksTakenToday(
	employeeId: string,
	timezone: string = "UTC",
): Promise<number> {
	const { start: todayStartDT, end: todayEndDT } = getTodayRangeInTimezone(timezone);
	const todayStart = dateToDB(todayStartDT)!;
	const todayEnd = dateToDB(todayEndDT)!;

	// Get all completed work periods for today, sorted by start time
	const periods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			gte(workPeriod.startTime, todayStart),
			lte(workPeriod.startTime, todayEnd),
		),
		orderBy: [workPeriod.startTime],
	});

	// Calculate gaps between consecutive work periods
	let totalBreakMinutes = 0;

	for (let i = 0; i < periods.length - 1; i++) {
		const currentEnd = periods[i].endTime;
		const nextStart = periods[i + 1].startTime;

		if (currentEnd && nextStart) {
			const gapMs = nextStart.getTime() - currentEnd.getTime();
			const gapMinutes = Math.floor(gapMs / 60000);
			// Only count gaps > 1 minute as breaks
			if (gapMinutes > 1) {
				totalBreakMinutes += gapMinutes;
			}
		}
	}

	return totalBreakMinutes;
}

/**
 * Calculate and persist surcharge credits for a work period
 * Only runs if surcharges are enabled for the organization
 * Errors are logged but don't fail the clock-out
 */
async function calculateAndPersistSurcharges(
	workPeriodId: string,
	organizationId: string,
): Promise<void> {
	try {
		const surchargeEffect = Effect.gen(function* (_) {
			const surchargeService = yield* _(SurchargeService);

			// Check if surcharges are enabled for this organization
			const isEnabled = yield* _(surchargeService.isSurchargesEnabled(organizationId));
			if (!isEnabled) {
				return;
			}

			// Persist the surcharge calculation
			yield* _(surchargeService.persistSurchargeCalculation(workPeriodId));
		}).pipe(Effect.provide(SurchargeServiceLive), Effect.provide(DatabaseServiceLive));

		await Effect.runPromise(surchargeEffect);
	} catch (error) {
		// Log the error but don't fail the clock-out
		logger.error({ error, workPeriodId }, "Failed to calculate surcharges after clock-out");
	}
}

/**
 * Enforce breaks after clock-out by automatically splitting work periods
 * if they violate break requirements.
 * Errors are logged but don't fail the clock-out.
 */
async function enforceBreaksAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	sessionDurationMinutes: number;
	timezone: string;
	createdBy: string;
}): Promise<BreakEnforcementResult> {
	try {
		const enforcementEffect = Effect.gen(function* (_) {
			const breakService = yield* _(BreakEnforcementService);

			return yield* _(breakService.enforceBreaksAfterClockOut(input));
		}).pipe(
			Effect.provide(BreakEnforcementServiceLive),
			Effect.provide(TimeRegulationServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		return await Effect.runPromise(enforcementEffect);
	} catch (error) {
		// Log the error but don't fail the clock-out
		logger.error(
			{ error, workPeriodId: input.workPeriodId },
			"Failed to enforce breaks after clock-out",
		);
		return { wasAdjusted: false };
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

// Re-export types for consumers
export type { ComplianceWarning } from "@/lib/time-regulations/validation";

/**
 * Get break reminder status for the currently active session
 * Returns information about break requirements and whether a break is needed soon
 */
export async function getBreakReminderStatus(): Promise<
	ServerActionResult<{
		needsBreakSoon: boolean;
		uninterruptedMinutes: number;
		maxUninterrupted: number | null;
		minutesUntilBreakRequired: number | null;
		breakRequirement: {
			isRequired: boolean;
			totalNeeded: number;
			taken: number;
			remaining: number;
		} | null;
	}>
> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	// Get user's timezone for calculations from userSettings
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { timezone: true },
	});
	const timezone = settingsData?.timezone || "UTC";

	// Get active work period
	const activePeriod = await getActiveWorkPeriod(emp.id);
	if (!activePeriod) {
		return {
			success: true,
			data: {
				needsBreakSoon: false,
				uninterruptedMinutes: 0,
				maxUninterrupted: null,
				minutesUntilBreakRequired: null,
				breakRequirement: null,
			},
		};
	}

	try {
		// Calculate current session duration
		const now = new Date();
		const durationMs = now.getTime() - activePeriod.startTime.getTime();
		const currentSessionMinutes = Math.floor(durationMs / 60000);

		// Get time summary and breaks using employee's timezone
		const timeSummary = await getTimeSummary(emp.id, timezone);
		const breaksTaken = await calculateBreaksTakenToday(emp.id, timezone);

		// Use Effect to get regulation and check break requirements
		const breakStatusEffect = Effect.gen(function* (_) {
			const regulationService = yield* _(TimeRegulationService);

			const regulation = yield* _(regulationService.getEffectiveRegulation(emp.id));

			if (!regulation) {
				return {
					needsBreakSoon: false,
					uninterruptedMinutes: currentSessionMinutes,
					maxUninterrupted: null,
					minutesUntilBreakRequired: null,
					breakRequirement: null,
				};
			}

			// Calculate break requirements
			const breakReq = regulationService.calculateBreakRequirements({
				regulation,
				workedMinutes: timeSummary.todayMinutes + currentSessionMinutes,
				breaksTakenMinutes: breaksTaken,
			});

			// Calculate time until break is required
			const maxUninterrupted = regulation.maxUninterruptedMinutes;
			let minutesUntilBreakRequired: number | null = null;
			let needsBreakSoon = false;

			if (maxUninterrupted) {
				const remaining = maxUninterrupted - currentSessionMinutes;
				minutesUntilBreakRequired = remaining;

				// Warn when 15 minutes or less remaining
				if (remaining <= 15 && remaining > 0) {
					needsBreakSoon = true;
				} else if (remaining <= 0) {
					needsBreakSoon = true;
				}
			}

			// Also check if break requirement is approaching
			if (breakReq.isRequired && breakReq.remaining > 0) {
				needsBreakSoon = true;
			}

			return {
				needsBreakSoon,
				uninterruptedMinutes: currentSessionMinutes,
				maxUninterrupted: maxUninterrupted,
				minutesUntilBreakRequired,
				breakRequirement: breakReq.isRequired
					? {
							isRequired: true,
							totalNeeded: breakReq.totalBreakNeeded,
							taken: breakReq.breakTaken,
							remaining: breakReq.remaining,
						}
					: null,
			};
		}).pipe(Effect.provide(TimeRegulationServiceLive), Effect.provide(DatabaseServiceLive));

		const breakStatus = await Effect.runPromise(breakStatusEffect);
		return { success: true, data: breakStatus };
	} catch (error) {
		logger.error({ error }, "Failed to get break reminder status");
		return { success: false, error: "Failed to check break status" };
	}
}

/**
 * Update notes/description for a work period
 * This updates the clock-out time entry's notes field
 */
export async function updateWorkPeriodNotes(
	workPeriodId: string,
	notes: string,
): Promise<ServerActionResult<{ workPeriodId: string }>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		// Get the work period
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return { success: false, error: "You can only update your own work periods" };
		}

		// Work period must be completed (have a clock-out entry)
		if (!period.clockOutId) {
			return { success: false, error: "Cannot add notes to an active work period" };
		}

		// Update the clock-out entry's notes
		await db.update(timeEntry).set({ notes }).where(eq(timeEntry.id, period.clockOutId));

		return { success: true, data: { workPeriodId } };
	} catch (error) {
		logger.error({ error }, "Update work period notes error");
		return { success: false, error: "Failed to update notes. Please try again." };
	}
}

/**
 * Delete a work period (convert to break)
 * Used to remove a work period, which creates a gap that appears as a break in the calendar
 * The associated time entries are marked as superseded for audit trail
 */
export async function deleteWorkPeriod(
	workPeriodId: string,
): Promise<ServerActionResult<{ deleted: boolean }>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		// Get the work period
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return { success: false, error: "You can only delete your own work periods" };
		}

		// Cannot delete active work periods
		if (!period.endTime || !period.clockOutId) {
			return {
				success: false,
				error: "Cannot delete an active work period. Please clock out first.",
			};
		}

		// Mark time entries as superseded (audit trail)
		// This keeps the time entry records for compliance/auditing
		await db
			.update(timeEntry)
			.set({
				isSuperseded: true,
				notes: `[Deleted - converted to break by ${session.user.name || session.user.email}]`,
			})
			.where(eq(timeEntry.id, period.clockInId));

		await db
			.update(timeEntry)
			.set({
				isSuperseded: true,
				notes: `[Deleted - converted to break by ${session.user.name || session.user.email}]`,
			})
			.where(eq(timeEntry.id, period.clockOutId));

		// Delete the work period record
		await db.delete(workPeriod).where(eq(workPeriod.id, workPeriodId));

		logger.info(
			{
				workPeriodId,
				employeeId: emp.id,
				deletedBy: session.user.id,
			},
			"Work period deleted (converted to break)",
		);

		return { success: true, data: { deleted: true } };
	} catch (error) {
		logger.error({ error }, "Delete work period error");
		return { success: false, error: "Failed to delete work period. Please try again." };
	}
}

/**
 * Split a work period into two separate periods at a given time
 * Used to divide a single work session into multiple segments with distinct descriptions
 */
export async function splitWorkPeriod(
	workPeriodId: string,
	splitTime: string, // HH:mm format
	beforeNotes?: string,
	afterNotes?: string,
): Promise<ServerActionResult<{ firstPeriodId: string; secondPeriodId: string }>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		// Get the work period with related entries
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return { success: false, error: "You can only split your own work periods" };
		}

		// Work period must be completed (have an end time)
		if (!period.endTime || !period.clockOutId) {
			return { success: false, error: "Cannot split an active work period" };
		}

		// Calculate the split timestamp
		const startDT = dateFromDB(period.startTime);
		const endDT = dateFromDB(period.endTime);
		if (!startDT || !endDT) {
			return { success: false, error: "Invalid work period times" };
		}

		const [splitHours, splitMinutes] = splitTime.split(":");
		const splitDT = startDT.set({
			hour: parseInt(splitHours, 10),
			minute: parseInt(splitMinutes, 10),
			second: 0,
			millisecond: 0,
		});
		const splitDate = dateToDB(splitDT);

		if (!splitDate) {
			return { success: false, error: "Invalid split time" };
		}

		// Validate split time is between start and end
		if (splitDate <= period.startTime || splitDate >= period.endTime) {
			return {
				success: false,
				error: "Split time must be between work period start and end times",
			};
		}

		// Validate the split times (check for holidays)
		const validation = await validateTimeEntryRange(
			emp.organizationId,
			period.startTime,
			period.endTime,
		);

		if (!validation.isValid) {
			return {
				success: false,
				error: validation.error || "Cannot split work period",
				holidayName: validation.holidayName,
			};
		}

		// Get request metadata
		const headersList = await headers();
		const ipAddress =
			headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown";
		const userAgent = headersList.get("user-agent") || "unknown";

		// Create clock-out entry for first period at split time
		const firstClockOut = await createTimeEntry({
			employeeId: emp.id,
			type: "clock_out",
			timestamp: splitDate,
			createdBy: session.user.id,
			notes: beforeNotes,
		});

		// Create clock-in entry for second period at split time
		const secondClockIn = await createTimeEntry({
			employeeId: emp.id,
			type: "clock_in",
			timestamp: splitDate,
			createdBy: session.user.id,
			notes: afterNotes,
		});

		// Update the original work period clock-out entry with notes if provided
		if (beforeNotes && period.clockOutId) {
			// Mark original clock-out as superseded
			await db
				.update(timeEntry)
				.set({
					isSuperseded: true,
					supersededById: firstClockOut.id,
				})
				.where(eq(timeEntry.id, period.clockOutId));
		}

		// Calculate durations
		const firstDurationMs = splitDate.getTime() - period.startTime.getTime();
		const firstDurationMinutes = Math.floor(firstDurationMs / 60000);

		const secondDurationMs = period.endTime.getTime() - splitDate.getTime();
		const secondDurationMinutes = Math.floor(secondDurationMs / 60000);

		// Update the original work period to end at split time
		await db
			.update(workPeriod)
			.set({
				clockOutId: firstClockOut.id,
				endTime: splitDate,
				durationMinutes: firstDurationMinutes,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, period.id));

		// Create a new work period for the second segment
		const [secondPeriod] = await db
			.insert(workPeriod)
			.values({
				employeeId: emp.id,
				clockInId: secondClockIn.id,
				clockOutId: period.clockOutId, // Use original clock-out for second period
				startTime: splitDate,
				endTime: period.endTime,
				durationMinutes: secondDurationMinutes,
				isActive: false,
			})
			.returning();

		// Update the original clock-out entry with afterNotes if provided
		if (afterNotes && period.clockOutId) {
			await db
				.update(timeEntry)
				.set({ notes: afterNotes })
				.where(eq(timeEntry.id, period.clockOutId));
		}

		logger.info(
			{
				originalPeriodId: workPeriodId,
				firstPeriodId: period.id,
				secondPeriodId: secondPeriod.id,
				splitTime,
			},
			"Work period split successfully",
		);

		return {
			success: true,
			data: { firstPeriodId: period.id, secondPeriodId: secondPeriod.id },
		};
	} catch (error) {
		logger.error({ error }, "Split work period error");
		return { success: false, error: "Failed to split work period. Please try again." };
	}
}

/**
 * Update notes/description for a time entry
 * Used after clock-out to add optional description about work done
 */
export async function updateTimeEntryNotes(
	entryId: string,
	notes: string,
): Promise<ServerActionResult<{ entryId: string }>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		// Get the time entry
		const [entry] = await db.select().from(timeEntry).where(eq(timeEntry.id, entryId)).limit(1);

		if (!entry) {
			return { success: false, error: "Time entry not found" };
		}

		// Verify ownership
		if (entry.employeeId !== emp.id) {
			return { success: false, error: "You can only update your own time entries" };
		}

		// Update the notes
		await db.update(timeEntry).set({ notes }).where(eq(timeEntry.id, entryId));

		return { success: true, data: { entryId } };
	} catch (error) {
		logger.error({ error }, "Update time entry notes error");
		return { success: false, error: "Failed to update notes. Please try again." };
	}
}

export interface AssignedProject {
	id: string;
	name: string;
	color: string | null;
	status: string;
}

/**
 * Get all projects the current employee can book time to
 * Returns projects that:
 * - Are in bookable status (planned, active, paused)
 * - The employee is assigned to (directly or via team)
 */
export async function getAssignedProjects(): Promise<ServerActionResult<AssignedProject[]>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		// Bookable statuses
		const bookableStatuses = ["planned", "active", "paused"];

		// Get projects assigned directly to employee or via team
		const directAssignments = await db.query.projectAssignment.findMany({
			where: eq(projectAssignment.employeeId, emp.id),
			with: {
				project: true,
			},
		});

		// Get projects assigned via team if employee is in a team
		const teamAssignments = emp.teamId
			? await db.query.projectAssignment.findMany({
					where: eq(projectAssignment.teamId, emp.teamId),
					with: {
						project: true,
					},
				})
			: [];

		// Combine and deduplicate projects
		const projectsMap = new Map<string, AssignedProject>();

		for (const assignment of [...directAssignments, ...teamAssignments]) {
			const proj = assignment.project;
			if (proj && bookableStatuses.includes(proj.status) && !projectsMap.has(proj.id)) {
				projectsMap.set(proj.id, {
					id: proj.id,
					name: proj.name,
					color: proj.color,
					status: proj.status,
				});
			}
		}

		// Sort by name
		const projects = Array.from(projectsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

		return { success: true, data: projects };
	} catch (error) {
		logger.error({ error }, "Failed to get assigned projects");
		return { success: false, error: "Failed to load projects" };
	}
}

/**
 * Update the project assignment for a work period
 * Allows changing or removing the project after the fact
 */
export async function updateWorkPeriodProject(
	workPeriodId: string,
	projectId: string | null,
): Promise<ServerActionResult<{ workPeriodId: string; projectId: string | null }>> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		// Get the work period
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return { success: false, error: "You can only update your own work periods" };
		}

		// Validate project if provided
		if (projectId) {
			const projectValidation = await validateProjectAssignment(projectId, emp.id, emp.teamId);
			if (!projectValidation.isValid) {
				return {
					success: false,
					error: projectValidation.error || "Cannot assign to this project",
				};
			}
		}

		// Update the work period
		await db
			.update(workPeriod)
			.set({
				projectId: projectId,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, workPeriodId));

		return {
			success: true,
			data: { workPeriodId, projectId },
		};
	} catch (error) {
		logger.error({ error }, "Failed to update work period project");
		return { success: false, error: "Failed to update project assignment" };
	}
}

/**
 * Helper function to create an approval request for clock-out (0-day policy)
 * Creates the approval request and sends notification to manager
 */
async function createClockOutApprovalRequest(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
}): Promise<void> {
	const { workPeriodId, employeeId, managerId, organizationId, startTime, endTime, durationMinutes } = params;

	try {
		// Create approval request
		await db.insert(approvalRequest).values({
			entityType: "time_entry",
			entityId: workPeriodId,
			requestedBy: employeeId,
			approverId: managerId,
			status: "pending",
			reason: "Clock-out requires approval (0-day policy)",
		});

		// Get employee and manager details for notifications
		const [employeeData, managerData] = await Promise.all([
			db.query.employee.findFirst({
				where: eq(employee.id, employeeId),
				with: { user: { columns: { id: true, name: true } } },
			}),
			db.query.employee.findFirst({
				where: eq(employee.id, managerId),
				columns: { userId: true },
			}),
		]);

		const employeeUserId = employeeData?.userId;
		const employeeName = employeeData?.user?.name || "Employee";
		const managerUserId = managerData?.userId;

		// Fire-and-forget: Send notifications
		if (employeeUserId) {
			void onClockOutPendingApproval({
				workPeriodId,
				employeeUserId,
				employeeName,
				organizationId,
				startTime,
				endTime,
				durationMinutes,
			}).catch((err) => {
				logger.error({ error: err }, "Failed to send clock-out pending notification to employee");
			});
		}

		if (managerUserId) {
			void onClockOutPendingApprovalToManager({
				workPeriodId,
				employeeUserId: employeeUserId || "",
				employeeName,
				organizationId,
				startTime,
				endTime,
				durationMinutes,
				managerUserId,
			}).catch((err) => {
				logger.error({ error: err }, "Failed to send clock-out pending notification to manager");
			});
		}

		logger.info(
			{
				workPeriodId,
				employeeId,
				managerId,
				durationMinutes,
			},
			"Clock-out approval request created",
		);
	} catch (error) {
		// Log but don't fail - approval request is secondary to clock-out completing
		logger.error({ error, workPeriodId }, "Failed to create clock-out approval request");
	}
}

/**
 * Helper function to check project budget warnings after clock-out
 * Gets project details and total hours, then triggers budget warning check
 */
async function checkProjectBudgetAfterClockOut(
	projectId: string,
	organizationId: string,
): Promise<void> {
	// Get project details
	const proj = await db.query.project.findFirst({
		where: eq(project.id, projectId),
		columns: {
			id: true,
			name: true,
			budgetHours: true,
		},
	});

	// Skip if project not found or has no budget
	if (!proj || !proj.budgetHours) {
		return;
	}

	const budgetHours = parseFloat(proj.budgetHours);
	if (isNaN(budgetHours) || budgetHours <= 0) {
		return;
	}

	// Get total hours booked to this project
	const totalHours = await getProjectTotalHours(projectId);

	// Trigger budget warning check
	await checkProjectBudgetWarnings({
		projectId,
		projectName: proj.name,
		organizationId,
		budgetHours,
		usedHours: totalHours,
	});
}

/**
 * Get the edit capability for a work period based on change policy
 * Returns information about what kind of edits are allowed
 */
export async function getWorkPeriodEditCapability(
	workPeriodId: string,
): Promise<
	ServerActionResult<{
		capability: EditCapability;
		policyName: string | null;
	}>
> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	// Get user's timezone from userSettings
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { timezone: true },
	});
	const timezone = settingsData?.timezone || "UTC";

	// Get the work period
	const [period] = await db
		.select()
		.from(workPeriod)
		.where(eq(workPeriod.id, workPeriodId))
		.limit(1);

	if (!period) {
		return { success: false, error: "Work period not found" };
	}

	// Verify ownership
	if (period.employeeId !== emp.id) {
		return { success: false, error: "You can only check your own work periods" };
	}

	// Work period must be completed
	if (!period.endTime) {
		return {
			success: true,
			data: {
				capability: { type: "forbidden", reason: "beyond_approval_window", daysBack: 0 },
				policyName: null,
			},
		};
	}

	try {
		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const policyService = yield* _(ChangePolicyService);

				// Get the resolved policy for context
				const policy = yield* _(policyService.resolvePolicy(emp.id));

				// Get edit capability
				const capability = yield* _(
					policyService.getEditCapability({
						employeeId: emp.id,
						workPeriodEndTime: period.endTime!,
						timezone,
					}),
				);

				return {
					capability,
					policyName: policy?.policyName || null,
				};
			}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive)),
		);

		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to get edit capability");
		return { success: false, error: "Failed to check edit permissions" };
	}
}

// Re-export EditCapability type for UI components
export type { EditCapability } from "@/lib/effect/services/change-policy.service";
