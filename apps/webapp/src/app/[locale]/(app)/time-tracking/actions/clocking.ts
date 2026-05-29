"use server";

import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime, IANAZone } from "luxon";
import { db } from "@/db";
import { employee, workPeriod } from "@/db/schema";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import {
	isWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";
import { validateTimeEntry, validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
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
import type { BrowserTimezoneContext, ClockOutResult, ManualTimeEntryInput } from "./types";

type ManualEntryOverlapResult =
	| {
			adjustedClockIn: Date;
			adjustedClockOut: Date;
			wasAdjusted: boolean;
	  }
	| {
			error: string;
	  };

type WorkBalanceDirtyInput = Parameters<typeof markEmployeeWorkBalanceDirty>[0];

const APPROVAL_POLICY_CHECK_ERROR = "Could not verify time approval policy. Please try again.";

async function markWorkBalanceDirtyAfterClockOutBestEffort(
	input: WorkBalanceDirtyInput,
	context: Record<string, unknown>,
) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error({ error, ...context }, "Failed to mark work balance dirty after clock-out");
	}
}

async function markWorkBalanceDirtyAfterManualTimeEntryBestEffort(
	input: WorkBalanceDirtyInput,
	context: Record<string, unknown>,
) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error({ error, ...context }, "Failed to mark work balance dirty after manual time entry");
	}
}

export async function clockIn(
	workLocationType?: WorkLocationType,
	timezoneContext: BrowserTimezoneContext = {},
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

	const resolvedWorkLocationType = workLocationType ?? "office";

	if (!isWorkLocationType(resolvedWorkLocationType)) {
		return { success: false, error: "Invalid work location type" };
	}

	const billingAccess = await requireBillingForMutation(currentEmployee.organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	try {
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: now,
			browserTimezone: timezoneContext.browserTimezone,
			fallbackTimezone: timezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
		const entry = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_in",
			timestamp: now,
			createdBy: session.user.id,
			...timezoneCapture,
		});

		await db.insert(workPeriod).values({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			clockInId: entry.id,
			startTime: now,
			workLocationType: resolvedWorkLocationType,
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
	timezoneContext: BrowserTimezoneContext = {},
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

	const billingAccess = await requireBillingForMutation(currentEmployee.organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	let needsClockOutApproval = false;
	try {
		needsClockOutApproval = await checkClockOutNeedsApproval(currentEmployee.id);
	} catch (error) {
		logger.warn({ error }, "Failed to check clock-out approval requirement");
		return { success: false, error: APPROVAL_POLICY_CHECK_ERROR };
	}

	try {
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: now,
			browserTimezone: timezoneContext.browserTimezone,
			fallbackTimezone: timezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
		const managerId = needsClockOutApproval
			? await getPrimaryEligibleManagerIdForRequester({
					db,
					requesterEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				})
			: null;
		if (needsClockOutApproval && !managerId) {
			return { success: false, error: "No manager assigned to approve time changes" };
		}

		const { entry, durationMinutes } = await db.transaction(async (tx) => {
			const clockOutEntry = await createTimeEntry(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					type: "clock_out",
					timestamp: now,
					createdBy: session.user.id,
					...timezoneCapture,
				},
				tx,
			);

			const sessionDurationMinutes = calculateDurationMinutes(activeWorkPeriod.startTime, now);
			const approvalStatus = needsClockOutApproval ? "pending" : "approved";
			const pendingChanges = needsClockOutApproval
				? {
						originalStartTime: activeWorkPeriod.startTime.toISOString(),
						originalEndTime: now.toISOString(),
						originalDurationMinutes: sessionDurationMinutes,
						requestedAt: now.toISOString(),
						requestedBy: session.user.id,
						isNewClockOut: true,
					}
				: null;

			const [closedWorkPeriod] = await tx
				.update(workPeriod)
				.set({
					clockOutId: clockOutEntry.id,
					endTime: now,
					durationMinutes: sessionDurationMinutes,
					projectId: projectId || null,
					workCategoryId: workCategoryId || null,
					isActive: false,
					approvalStatus,
					pendingChanges,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(workPeriod.id, activeWorkPeriod.id),
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
					),
				)
				.returning({ id: workPeriod.id });

			if (!closedWorkPeriod) {
				throw new Error("Active work period was not updated");
			}

			return { entry: clockOutEntry, durationMinutes: sessionDurationMinutes };
		});

		await calculateAndPersistSurcharges(activeWorkPeriod.id, currentEmployee.organizationId);
		if (needsClockOutApproval && managerId) {
			await createClockOutApprovalRequest({
				workPeriodId: activeWorkPeriod.id,
				employeeId: currentEmployee.id,
				managerId,
				organizationId: currentEmployee.organizationId,
				startTime: activeWorkPeriod.startTime,
				endTime: now,
				durationMinutes,
			});
		}

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

		await markWorkBalanceDirtyAfterClockOutBestEffort(
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				dirtyFromDate:
					DateTime.fromJSDate(activeWorkPeriod.startTime, { zone: "utc" }).toISODate() ?? undefined,
			},
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				workPeriodId: activeWorkPeriod.id,
			},
		);

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
				pendingApproval: needsClockOutApproval || undefined,
				complianceWarnings: complianceWarnings.length > 0 ? complianceWarnings : undefined,
				breakAdjustment: breakEnforcementResult.wasAdjusted
					? breakEnforcementResult.adjustment
					: undefined,
			},
		};
	} catch (error) {
		logger.error({ error }, "Clock out error");
		return { success: false, error: "Failed to clock out. Please try again." };
	}
}

export async function addBreakToActiveSession(
	breakMinutes: number,
): Promise<ServerActionResult<{ id: string; startTime: Date }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	if (!Number.isInteger(breakMinutes) || breakMinutes < 1) {
		return { success: false, error: "Enter a break duration of at least 1 minute." };
	}

	const activeWorkPeriod = await getActiveWorkPeriod(currentEmployee.id);
	if (!activeWorkPeriod) {
		return { success: false, error: "You are not currently clocked in." };
	}

	if (activeWorkPeriod.organizationId !== currentEmployee.organizationId) {
		return { success: false, error: "You are not allowed to edit this time entry" };
	}

	const timezone = await getUserTimezone(session.user.id);

	const now = new Date();
	const breakStart = new Date(now.getTime() - breakMinutes * ONE_MINUTE_MS);
	if (breakStart <= activeWorkPeriod.startTime) {
		return { success: false, error: "Break duration must be shorter than your current session." };
	}

	try {
		const breakStartTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: breakStart,
			timezone,
			timezoneSource: "user_setting",
		});
		const nowTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: now,
			timezone,
			timezoneSource: "user_setting",
		});
		const newWorkPeriod = await db.transaction(async (tx) => {
			const clockOutEntry = await createTimeEntry(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					type: "clock_out",
					timestamp: breakStart,
					createdBy: session.user.id,
					...breakStartTimezoneCapture,
				},
				tx,
			);

			const durationMinutes = calculateDurationMinutes(activeWorkPeriod.startTime, breakStart);

			const [closedWorkPeriod] = await tx
				.update(workPeriod)
				.set({
					clockOutId: clockOutEntry.id,
					endTime: breakStart,
					durationMinutes,
					isActive: false,
					approvalStatus: "approved",
					pendingChanges: null,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(workPeriod.id, activeWorkPeriod.id),
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						eq(workPeriod.isActive, true),
					),
				)
				.returning({ id: workPeriod.id });

			if (!closedWorkPeriod) {
				throw new Error("Active work period was not updated");
			}

			const clockInEntry = await createTimeEntry(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					type: "clock_in",
					timestamp: now,
					createdBy: session.user.id,
					...nowTimezoneCapture,
				},
				tx,
			);

			const [insertedWorkPeriod] = await tx
				.insert(workPeriod)
				.values({
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					clockInId: clockInEntry.id,
					startTime: now,
					workLocationType: activeWorkPeriod.workLocationType ?? "office",
				})
				.returning({ id: workPeriod.id, startTime: workPeriod.startTime });

			if (!insertedWorkPeriod) {
				throw new Error("New work period was not inserted");
			}

			return insertedWorkPeriod;
		});

		await markWorkBalanceDirtyAfterClockOutBestEffort(
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				dirtyFromDate:
					DateTime.fromJSDate(activeWorkPeriod.startTime, { zone: "utc" }).toISODate() ?? undefined,
			},
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				workPeriodId: activeWorkPeriod.id,
			},
		);

		return { success: true, data: newWorkPeriod };
	} catch (error) {
		logger.error({ error }, "Add break to active session error");
		return { success: false, error: "Failed to add break. Please try again." };
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
	const targetEmployeeId = data.employeeId ?? currentEmployee.id;
	let targetEmployee = currentEmployee;
	if (targetEmployeeId !== currentEmployee.id) {
		const organizationEmployees = await db.query.employee.findMany({
			where: eq(employee.organizationId, currentEmployee.organizationId),
		});
		const resolvedTarget = organizationEmployees.find(
			(employeeRecord) =>
				employeeRecord.id === targetEmployeeId &&
				employeeRecord.organizationId === currentEmployee.organizationId,
		);
		if (!resolvedTarget) {
			return { success: false, error: "Not authorized to create time entries for this employee" };
		}
		targetEmployee = resolvedTarget;
	}
	const isOwnEntry = targetEmployee.id === currentEmployee.id;

	const savedTimezone = isOwnEntry
		? await getUserTimezone(session.user.id)
		: await getUserTimezone(targetEmployee.userId ?? session.user.id);
	if (data.timezone !== undefined && !IANAZone.isValidZone(data.timezone)) {
		return { success: false, error: "Invalid timezone" };
	}
	const timezone = data.timezone ?? savedTimezone;
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
		targetEmployee.organizationId,
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
			targetEmployee.id,
			targetEmployee.teamId,
		);

		if (!projectValidation.isValid) {
			return {
				success: false,
				error: projectValidation.error || "Cannot assign to this project",
			};
		}
	}

	let requiresApproval = false;
	if (isOwnEntry) {
		let editCapability;
		try {
			editCapability = await getEditCapabilityForPeriod({
				employeeId: targetEmployee.id,
				workPeriodEndTime: clockOutDate,
				timezone,
			});
		} catch (error) {
			logger.error({ error }, "Failed to check edit capability for manual entry");
			return { success: false, error: APPROVAL_POLICY_CHECK_ERROR };
		}

		if (editCapability.type === "forbidden") {
			return {
				success: false,
				error: `Entries older than ${editCapability.daysBack} days can only be created by admins or team leads.`,
			};
		}

		requiresApproval = editCapability.type === "approval_required";
	}

	try {
		const localDate = DateTime.fromISO(data.date, { zone: timezone });
		if (!localDate.isValid) {
			return { success: false, error: "Invalid date format" };
		}

		const existingWorkPeriods = await db.query.workPeriod.findMany({
			where: and(
				eq(workPeriod.employeeId, targetEmployee.id),
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
		const clockInTimezoneCapture = isOwnEntry
			? resolveTimeEntryTimezoneCapture({
					timestamp: adjustedClockIn,
					browserTimezone: data.browserTimezone,
					fallbackTimezone: timezone,
					browserSource: "browser",
					fallbackSource: "user_setting",
				})
			: resolveFallbackTimezoneCapture({
					timestamp: adjustedClockIn,
					timezone,
					timezoneSource: "manager_target_user_setting",
				});
		const clockOutTimezoneCapture = isOwnEntry
			? resolveTimeEntryTimezoneCapture({
					timestamp: adjustedClockOut,
					browserTimezone: data.browserTimezone,
					fallbackTimezone: timezone,
					browserSource: "browser",
					fallbackSource: "user_setting",
				})
			: resolveFallbackTimezoneCapture({
					timestamp: adjustedClockOut,
					timezone,
					timezoneSource: "manager_target_user_setting",
				});
		const managerId = requiresApproval
			? await getPrimaryEligibleManagerIdForRequester({
					db,
					requesterEmployeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
				})
			: null;
		const requiresManagerApproval = requiresApproval && Boolean(managerId);
		const durationMinutes = calculateDurationMinutes(adjustedClockIn, adjustedClockOut);
		const createdWorkPeriod = await db.transaction(async (tx) => {
			const clockInEntry = await createTimeEntry(
				{
					employeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
					type: "clock_in",
					timestamp: adjustedClockIn,
					createdBy: session.user.id,
					notes: `Manual entry: ${data.reason}`,
					...clockInTimezoneCapture,
				},
				tx,
			);
			const clockOutEntry = await createTimeEntry(
				{
					employeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
					type: "clock_out",
					timestamp: adjustedClockOut,
					createdBy: session.user.id,
					notes: data.reason,
					...clockOutTimezoneCapture,
				},
				tx,
			);

			const [period] = await tx
				.insert(workPeriod)
				.values({
					employeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
					clockInId: clockInEntry.id,
					clockOutId: clockOutEntry.id,
					startTime: adjustedClockIn,
					endTime: adjustedClockOut,
					durationMinutes,
					projectId: data.projectId || null,
					workCategoryId: data.workCategoryId || null,
					isActive: false,
					approvalStatus: requiresManagerApproval ? "pending" : "approved",
					pendingChanges: requiresManagerApproval
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

			return period;
		});

		if (requiresManagerApproval && managerId) {
			await createManualEntryApprovalRequest({
				workPeriodId: createdWorkPeriod.id,
				employeeId: targetEmployee.id,
				managerId,
				organizationId: targetEmployee.organizationId,
				startTime: adjustedClockIn,
				endTime: adjustedClockOut,
				durationMinutes,
				reason: data.reason,
			});
		}

		if (!requiresManagerApproval) {
			await calculateAndPersistSurcharges(createdWorkPeriod.id, targetEmployee.organizationId);
		}

		await markWorkBalanceDirtyAfterManualTimeEntryBestEffort(
			{
				employeeId: targetEmployee.id,
				organizationId: targetEmployee.organizationId,
				dirtyFromDate:
					DateTime.fromJSDate(adjustedClockIn, { zone: "utc" }).toISODate() ?? undefined,
			},
			{
				employeeId: targetEmployee.id,
				organizationId: targetEmployee.organizationId,
				workPeriodId: createdWorkPeriod.id,
			},
		);

		logger.info(
			{
				workPeriodId: createdWorkPeriod.id,
				employeeId: targetEmployee.id,
				date: data.date,
				clockInTime: data.clockInTime,
				clockOutTime: data.clockOutTime,
				wasAdjusted,
				adjustedClockIn: wasAdjusted ? adjustedClockIn.toISOString() : undefined,
				adjustedClockOut: wasAdjusted ? adjustedClockOut.toISOString() : undefined,
				requiresApproval: requiresManagerApproval,
			},
			"Manual time entry created successfully",
		);

		return {
			success: true,
			data: {
				workPeriodId: createdWorkPeriod.id,
				requiresApproval: requiresManagerApproval,
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
