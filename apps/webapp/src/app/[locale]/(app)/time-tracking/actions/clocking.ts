"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { validateTimeEntry, validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { createClockOutApprovalRequest, createManualEntryApprovalRequest } from "./approvals";
import { getCurrentEmployee, getCurrentSession, getUserTimezone } from "./auth";
import {
	calculateAndPersistSurcharges,
	calculateBreaksTakenToday,
	checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut,
} from "./compliance";
import {
	checkProjectBudgetAfterClockOut,
	createTimeEntry,
	validateProjectAssignment,
} from "./entry-helpers";
import { checkClockOutNeedsApproval, getEditCapabilityForPeriod } from "./policy-helpers";
import { getActiveWorkPeriod, getTimeSummary } from "./queries";
import {
	BREAK_WARNING_THRESHOLD_MINUTES,
	EMPTY_BREAK_REMINDER_STATUS,
	logger,
	ONE_MINUTE_MS,
} from "./shared";
import { calculateDurationMinutes, createUtcDateTime } from "./time-utils";
import type { ClockOutResult, ManualTimeEntryInput } from "./types";

type ManualEntryOverlapResult =
	| {
			adjustedClockIn: Date;
			adjustedClockOut: Date;
			wasAdjusted: boolean;
	  }
	| {
			error: string;
	  };

export async function clockIn(
	workLocationType?: "office" | "home" | "field" | "other",
): Promise<ServerActionResult<Awaited<ReturnType<typeof createTimeEntry>>>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const timezone = await getUserTimezone(session.user.id);
	const activeWorkPeriod = await getActiveWorkPeriod(currentEmployee.id);
	if (activeWorkPeriod) {
		return { success: false, error: "You are already clocked in" };
	}

	const now = new Date();
	const validation = await validateTimeEntry(currentEmployee.organizationId, now, timezone);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock in at this time",
			holidayName: validation.holidayName,
		};
	}

	try {
		const entry = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_in",
			timestamp: now,
			createdBy: session.user.id,
		});

		await db.insert(workPeriod).values({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			clockInId: entry.id,
			startTime: now,
			workLocationType: workLocationType ?? null,
		});

		return { success: true, data: entry };
	} catch (error) {
		logger.error({ error }, "Clock in error");
		return { success: false, error: "Failed to clock in. Please try again." };
	}
}

export async function clockOut(
	projectId?: string,
	workCategoryId?: string,
): Promise<ServerActionResult<ClockOutResult>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const timezone = await getUserTimezone(session.user.id);
	const activeWorkPeriod = await getActiveWorkPeriod(currentEmployee.id);
	if (!activeWorkPeriod) {
		return { success: false, error: "You are not currently clocked in" };
	}

	const now = new Date();
	const validation = await validateTimeEntry(currentEmployee.organizationId, now, timezone);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot clock out at this time",
			holidayName: validation.holidayName,
		};
	}

	if (projectId) {
		const projectValidation = await validateProjectAssignment(
			projectId,
			currentEmployee.id,
			currentEmployee.teamId,
		);

		if (!projectValidation.isValid) {
			return {
				success: false,
				error: projectValidation.error || "Cannot assign to this project",
			};
		}
	}

	let needsClockOutApproval = false;
	try {
		needsClockOutApproval = await checkClockOutNeedsApproval(currentEmployee.id);
	} catch (error) {
		logger.warn({ error }, "Failed to check clock-out approval requirement");
	}

	try {
		const entry = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_out",
			timestamp: now,
			createdBy: session.user.id,
		});

		const durationMinutes = calculateDurationMinutes(activeWorkPeriod.startTime, now);
		const approvalStatus = needsClockOutApproval ? "pending" : "approved";
		const pendingChanges = needsClockOutApproval
			? {
					originalStartTime: activeWorkPeriod.startTime.toISOString(),
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
				pendingChanges,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, activeWorkPeriod.id));

		if (needsClockOutApproval && currentEmployee.managerId) {
			await createClockOutApprovalRequest({
				workPeriodId: activeWorkPeriod.id,
				employeeId: currentEmployee.id,
				managerId: currentEmployee.managerId,
				organizationId: currentEmployee.organizationId,
				startTime: activeWorkPeriod.startTime,
				endTime: now,
				durationMinutes,
			});
		}

		await calculateAndPersistSurcharges(activeWorkPeriod.id, currentEmployee.organizationId);

		const complianceWarnings = await checkComplianceAfterClockOut(
			currentEmployee.id,
			currentEmployee.organizationId,
			activeWorkPeriod.id,
			durationMinutes,
			timezone,
		);

		const breakEnforcementResult = await enforceBreaksAfterClockOut({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			workPeriodId: activeWorkPeriod.id,
			sessionDurationMinutes: durationMinutes,
			timezone,
			createdBy: session.user.id,
		});

		if (projectId) {
			void checkProjectBudgetAfterClockOut(projectId, currentEmployee.organizationId).catch(
				(error) => {
					logger.error({ error, projectId }, "Failed to check project budget warnings");
				},
			);
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
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const timezone = await getUserTimezone(session.user.id);
	const activeWorkPeriod = await getActiveWorkPeriod(currentEmployee.id);
	if (!activeWorkPeriod) {
		return { success: true, data: EMPTY_BREAK_REMINDER_STATUS };
	}

	try {
		const currentSessionMinutes = calculateDurationMinutes(activeWorkPeriod.startTime, new Date());
		const [timeSummary, breaksTaken] = await Promise.all([
			getTimeSummary(currentEmployee.id, timezone),
			calculateBreaksTakenToday(currentEmployee.id, timezone),
		]);

		const breakStatusEffect = Effect.gen(function* (_) {
			const workPolicyService = yield* _(WorkPolicyService);
			const policy = yield* _(workPolicyService.getEffectivePolicy(currentEmployee.id));

			if (!policy?.regulation) {
				return {
					...EMPTY_BREAK_REMINDER_STATUS,
					uninterruptedMinutes: currentSessionMinutes,
				};
			}

			const breakRequirement = workPolicyService.calculateBreakRequirements({
				regulation: policy.regulation,
				workedMinutes: timeSummary.todayMinutes + currentSessionMinutes,
				breaksTakenMinutes: breaksTaken,
			});

			const maxUninterrupted = policy.regulation.maxUninterruptedMinutes;
			const minutesUntilBreakRequired = maxUninterrupted
				? maxUninterrupted - currentSessionMinutes
				: null;
			const isBreakThresholdReached =
				minutesUntilBreakRequired !== null &&
				minutesUntilBreakRequired <= BREAK_WARNING_THRESHOLD_MINUTES;
			const needsBreakSoon =
				isBreakThresholdReached || (breakRequirement.isRequired && breakRequirement.remaining > 0);

			return {
				needsBreakSoon,
				uninterruptedMinutes: currentSessionMinutes,
				maxUninterrupted,
				minutesUntilBreakRequired,
				breakRequirement: breakRequirement.isRequired
					? {
							isRequired: true,
							totalNeeded: breakRequirement.totalBreakNeeded,
							taken: breakRequirement.breakTaken,
							remaining: breakRequirement.remaining,
						}
					: null,
			};
		}).pipe(Effect.provide(WorkPolicyServiceLive), Effect.provide(DatabaseServiceLive));

		return { success: true, data: await Effect.runPromise(breakStatusEffect) };
	} catch (error) {
		logger.error({ error }, "Failed to get break reminder status");
		return { success: false, error: "Failed to check break status" };
	}
}

function adjustManualEntryForOverlaps(
	existingWorkPeriods: Array<{ startTime: Date; endTime: Date | null }>,
	clockInDate: Date,
	clockOutDate: Date,
): ManualEntryOverlapResult {
	let adjustedClockIn = clockInDate;
	let adjustedClockOut = clockOutDate;
	let wasAdjusted = false;

	const sortedWorkPeriods = existingWorkPeriods
		.filter((workPeriod) => workPeriod.endTime !== null)
		.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

	for (const existingWorkPeriod of sortedWorkPeriods) {
		const periodStart = existingWorkPeriod.startTime.getTime();
		const periodEnd = existingWorkPeriod.endTime!.getTime();
		const newStart = adjustedClockIn.getTime();
		const newEnd = adjustedClockOut.getTime();

		if (newStart < periodEnd && newEnd > periodStart) {
			wasAdjusted = true;

			if (newStart < periodStart && newEnd > periodStart && newEnd <= periodEnd) {
				adjustedClockOut = new Date(periodStart - ONE_MINUTE_MS);
			} else if (newStart >= periodStart && newStart < periodEnd && newEnd > periodEnd) {
				adjustedClockIn = new Date(periodEnd + ONE_MINUTE_MS);
			} else if (newStart < periodStart && newEnd > periodEnd) {
				adjustedClockOut = new Date(periodStart - ONE_MINUTE_MS);
			} else if (newStart >= periodStart && newEnd <= periodEnd) {
				return {
					error: "The selected time range is completely covered by an existing work period.",
				} as const;
			}
		}
	}

	if (adjustedClockOut.getTime() - adjustedClockIn.getTime() < ONE_MINUTE_MS) {
		return {
			error:
				"After adjusting for existing entries, the remaining time is too short (less than 1 minute).",
		} as const;
	}

	return { adjustedClockIn, adjustedClockOut, wasAdjusted } as const;
}

export async function createManualTimeEntry(data: ManualTimeEntryInput): Promise<
	ServerActionResult<{
		workPeriodId: string;
		requiresApproval: boolean;
		wasAdjusted?: boolean;
		adjustedTimes?: {
			clockIn: string;
			clockOut: string;
			durationMinutes: number;
		};
	}>
> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const timezone = await getUserTimezone(session.user.id);
	const clockInDate = createUtcDateTime(data.date, data.clockInTime, timezone);
	const clockOutDate = createUtcDateTime(data.date, data.clockOutTime, timezone);

	if (!clockInDate || !clockOutDate) {
		return { success: false, error: "Invalid time values" };
	}

	const now = new Date();
	if (clockOutDate > now) {
		return { success: false, error: "Cannot create entries for future times" };
	}

	if (clockOutDate <= clockInDate) {
		return { success: false, error: "Clock out time must be after clock in time" };
	}

	const validation = await validateTimeEntryRange(
		currentEmployee.organizationId,
		clockInDate,
		clockOutDate,
	);
	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot create time entry for this period",
			holidayName: validation.holidayName,
		};
	}

	if (data.projectId) {
		const projectValidation = await validateProjectAssignment(
			data.projectId,
			currentEmployee.id,
			currentEmployee.teamId,
		);

		if (!projectValidation.isValid) {
			return {
				success: false,
				error: projectValidation.error || "Cannot assign to this project",
			};
		}
	}

	let editCapability;
	try {
		editCapability = await getEditCapabilityForPeriod({
			employeeId: currentEmployee.id,
			workPeriodEndTime: clockOutDate,
			timezone,
		});
	} catch (error) {
		logger.error({ error }, "Failed to check edit capability for manual entry");
		editCapability = { type: "direct", reason: "no_policy" };
	}

	if (editCapability.type === "forbidden") {
		return {
			success: false,
			error: `Entries older than ${editCapability.daysBack} days can only be created by admins or team leads.`,
		};
	}

	const requiresApproval = editCapability.type === "approval_required";

	try {
		const localDate = DateTime.fromISO(data.date, { zone: timezone });
		if (!localDate.isValid) {
			return { success: false, error: "Invalid date format" };
		}

		const existingWorkPeriods = await db.query.workPeriod.findMany({
			where: and(
				eq(workPeriod.employeeId, currentEmployee.id),
				gte(workPeriod.startTime, localDate.startOf("day").toUTC().toJSDate()),
				lte(workPeriod.startTime, localDate.endOf("day").toUTC().toJSDate()),
			),
		});

		if (existingWorkPeriods.some((workPeriod) => !workPeriod.endTime)) {
			return {
				success: false,
				error:
					"Cannot create manual entry while you have an active work period. Please clock out first.",
			};
		}

		const overlapResult = adjustManualEntryForOverlaps(
			existingWorkPeriods,
			clockInDate,
			clockOutDate,
		);
		if ("error" in overlapResult) {
			return { success: false, error: overlapResult.error };
		}

		const { adjustedClockIn, adjustedClockOut, wasAdjusted } = overlapResult;
		const managerId = currentEmployee.managerId;
		const durationMinutes = calculateDurationMinutes(adjustedClockIn, adjustedClockOut);
		const clockInEntry = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_in",
			timestamp: adjustedClockIn,
			createdBy: session.user.id,
			notes: `Manual entry: ${data.reason}`,
		});
		const clockOutEntry = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_out",
			timestamp: adjustedClockOut,
			createdBy: session.user.id,
			notes: data.reason,
		});

		const [createdWorkPeriod] = await db
			.insert(workPeriod)
			.values({
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				clockInId: clockInEntry.id,
				clockOutId: clockOutEntry.id,
				startTime: adjustedClockIn,
				endTime: adjustedClockOut,
				durationMinutes,
				projectId: data.projectId || null,
				workCategoryId: data.workCategoryId || null,
				isActive: false,
				approvalStatus: requiresApproval ? "pending" : "approved",
				pendingChanges: requiresApproval
					? {
							originalStartTime: adjustedClockIn.toISOString(),
							originalEndTime: adjustedClockOut.toISOString(),
							originalDurationMinutes: durationMinutes,
							requestedAt: now.toISOString(),
							requestedBy: session.user.id,
							reason: data.reason,
						}
					: null,
			})
			.returning();

		if (requiresApproval && managerId) {
			await createManualEntryApprovalRequest({
				workPeriodId: createdWorkPeriod.id,
				employeeId: currentEmployee.id,
				managerId,
				organizationId: currentEmployee.organizationId,
				startTime: adjustedClockIn,
				endTime: adjustedClockOut,
				durationMinutes,
				reason: data.reason,
			});
		}

		if (!requiresApproval) {
			await calculateAndPersistSurcharges(createdWorkPeriod.id, currentEmployee.organizationId);
		}

		logger.info(
			{
				workPeriodId: createdWorkPeriod.id,
				employeeId: currentEmployee.id,
				date: data.date,
				clockInTime: data.clockInTime,
				clockOutTime: data.clockOutTime,
				wasAdjusted,
				adjustedClockIn: wasAdjusted ? adjustedClockIn.toISOString() : undefined,
				adjustedClockOut: wasAdjusted ? adjustedClockOut.toISOString() : undefined,
				requiresApproval,
			},
			"Manual time entry created successfully",
		);

		return {
			success: true,
			data: {
				workPeriodId: createdWorkPeriod.id,
				requiresApproval,
				wasAdjusted,
				adjustedTimes: wasAdjusted
					? {
							clockIn: adjustedClockIn.toISOString(),
							clockOut: adjustedClockOut.toISOString(),
							durationMinutes,
						}
					: undefined,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to create manual time entry");
		return { success: false, error: "Failed to create time entry. Please try again." };
	}
}
