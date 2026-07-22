"use server";

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import * as z from "zod";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	project,
	projectAssignment,
	surchargeCalculation,
	timeEntry,
	userSettings,
	workPeriod,
	workPolicy,
	workPolicyPresence,
} from "@/db/schema";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { auth } from "@/lib/auth";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	type BreakEnforcementResult,
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";
import {
	DatabaseService,
	DatabaseServiceLive,
} from "@/lib/effect/services/database.service";
import {
	SurchargeService,
	SurchargeServiceLive,
} from "@/lib/effect/services/surcharge.service";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { createLogger } from "@/lib/logger";
import { resolveWorkPeriodSplit } from "@/lib/time-tracking/split-work-period";
import {
	resolveFallbackTimezoneCapture,
	type TimeEntryTimezoneSource,
} from "@/lib/time-tracking/timezone-capture";
import {
	getMonthRangeInTimezone,
	getTodayRangeInTimezone,
	getWeekRangeInTimezone,
} from "@/lib/time-tracking/timezone-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";
import {
	addBreakToActiveSession as addBreakToActiveSessionAction,
	clockIn as clockInAction,
	clockOut as clockOutAction,
	createManualTimeEntry as createManualTimeEntryModular,
} from "./actions/clocking";
import {
	editSameDayTimeEntry as editModularSameDayTimeEntry,
	requestTimeCorrectionEffect as requestModularTimeCorrectionEffect,
} from "./actions/corrections";
import {
	calculatePresenceStatusSummary,
	expandApprovedHomeOfficeDates,
	getPresencePeriodBounds,
	getPresenceWorkDays,
	type PresenceEvaluationPeriod,
	type PresenceStatusSummary,
	parsePresenceFixedDays,
	validatePresenceFixedDaysConfig,
} from "./actions/presence-status";
import type {
	BrowserTimezoneContext,
	ClockOutActionContext,
	ManualTimeEntryInput,
	CorrectionRequest as ModularCorrectionRequest,
	SameDayEditRequest as ModularSameDayEditRequest,
} from "./actions/types";
import { canonicalTimeEntryClient } from "./actions.canonical";
import type { WorkPeriodWithEntries } from "./types";

export async function addBreakToActiveSession(breakMinutes: number) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	const billingAccess = await requireBillingForMutation(emp.organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	return addBreakToActiveSessionAction(breakMinutes);
}

const logger = createLogger("TimeTrackingActionsEffect");

type ManagerResolverDb = Parameters<
	typeof getPrimaryEligibleManagerIdForRequester
>[0]["db"];

export async function resolveTimeApprovalManagerId(input: {
	db: ManagerResolverDb;
	requiresApproval: boolean;
	requesterEmployeeId: string;
	organizationId: string;
}): Promise<string | null> {
	if (!input.requiresApproval) {
		return null;
	}

	const managerId = await getPrimaryEligibleManagerIdForRequester({
		db: input.db,
		requesterEmployeeId: input.requesterEmployeeId,
		organizationId: input.organizationId,
	});
	if (!managerId) {
		throw new Error("No manager assigned to approve time changes");
	}
	return managerId;
}

type ProjectAssignmentWithProject = typeof projectAssignment.$inferSelect & {
	project: Pick<
		typeof project.$inferSelect,
		"id" | "name" | "color" | "status" | "budgetHours" | "deadline"
	> | null;
};

type CorrectionRequest = ModularCorrectionRequest;
type SameDayEditRequest = ModularSameDayEditRequest;

/**
 * Edit a time entry directly when allowed by the change policy
 * Uses the employee's effective change policy to determine if direct edit is allowed
 * or if manager approval is required
 */
export async function editSameDayTimeEntry(
	data: SameDayEditRequest,
): Promise<
	ServerActionResult<{ workPeriodId: string; requiresApproval?: boolean }>
> {
	return editModularSameDayTimeEntry(data);
}

export async function requestTimeCorrectionEffect(
	data: CorrectionRequest,
): Promise<
	ServerActionResult<{ approvalId: string; status: "approved" | "pending" }>
> {
	return requestModularTimeCorrectionEffect(data);
}

// =============================================================================
// Utility and Data-Fetching Functions (non-Effect)
// =============================================================================

/**
 * Get current employee from session
 */
export async function getCurrentEmployee(): Promise<
	typeof employee.$inferSelect | null
> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const activeOrgId = session.session?.activeOrganizationId;

	// If we have an active organization, get employee for that org
	if (activeOrgId) {
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
				eq(employee.isActive, true),
			),
		});
		if (emp) return emp;
	}

	// Fall back to first active employee record (for backwards compatibility)
	return null;
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
		return {
			hasEmployee: false,
			employeeId: null,
			isClockedIn: false,
			activeWorkPeriod: null,
		};
	}

	const activeOrgId = session.session?.activeOrganizationId;
	if (!activeOrgId) {
		return {
			hasEmployee: false,
			employeeId: null,
			isClockedIn: false,
			activeWorkPeriod: null,
		};
	}

	const emp = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, session.user.id),
			eq(employee.organizationId, activeOrgId),
			eq(employee.isActive, true),
		),
	});

	if (!emp) {
		return {
			hasEmployee: false,
			employeeId: null,
			isClockedIn: false,
			activeWorkPeriod: null,
		};
	}

	const period = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.employeeId, emp.id),
			eq(workPeriod.organizationId, emp.organizationId),
			isNull(workPeriod.endTime),
		),
	});

	return {
		hasEmployee: true,
		employeeId: emp.id,
		isClockedIn: !!period,
		activeWorkPeriod: period
			? { id: period.id, startTime: period.startTime }
			: null,
	};
}

/**
 * Get active work period for current employee
 */
export async function getActiveWorkPeriod(
	employeeId: string,
): Promise<WorkPeriodWithEntries | null> {
	const period = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			isNull(workPeriod.endTime),
		),
		with: {
			clockIn: true,
			clockOut: true,
		},
	});

	if (!period) return null;
	const typedPeriod = period as unknown as WorkPeriodWithEntries;

	return {
		...typedPeriod,
		clockIn: typedPeriod.clockIn,
		clockOut: typedPeriod.clockOut || undefined,
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
			isNull(workPeriod.deletedAt),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		),
		with: {
			clockIn: true,
			clockOut: true,
		},
		orderBy: [desc(workPeriod.startTime)],
	});

	const typedPeriods = periods as unknown as WorkPeriodWithEntries[];
	return typedPeriods.map((p) => ({
		...p,
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
	weekStartDay: WeekStartDay = "sunday",
): Promise<TimeSummary> {
	// Use timezone-aware boundaries for accurate day/week/month calculations
	const { start: todayStartDT, end: todayEndDT } =
		getTodayRangeInTimezone(timezone);
	const { start: weekStartDT, end: weekEndDT } = getWeekRangeInTimezone(
		new Date(),
		timezone,
		weekStartDay,
	);
	const { start: monthStartDT, end: monthEndDT } = getMonthRangeInTimezone(
		new Date(),
		timezone,
	);

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
		.leftJoin(
			surchargeCalculation,
			eq(surchargeCalculation.workPeriodId, workPeriod.id),
		)
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
				isNull(workPeriod.deletedAt),
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

	const monthMinutes = periodsWithSurcharges.reduce(
		(sum, p) => sum + (p.durationMinutes || 0),
		0,
	);

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
export async function clockIn(
	workLocationType?: WorkLocationType,
	timezoneContext: BrowserTimezoneContext = {},
): Promise<ServerActionResult<typeof timeEntry.$inferSelect>> {
	return clockInAction(workLocationType, timezoneContext) as Promise<
		ServerActionResult<typeof timeEntry.$inferSelect>
	>;
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
export async function clockOut(
	projectId: string | undefined,
	workCategoryId: string | undefined,
	timezoneContext: ClockOutActionContext,
): Promise<ServerActionResult<ClockOutResult>> {
	return clockOutAction(projectId, workCategoryId, timezoneContext);
}
/**
 * Validate that an employee can assign time to a project
 * Checks: project exists, is bookable (planned/active/paused), employee has access
 */
async function validateProjectAssignment(
	projectId: string,
	employeeId: string,
	teamId: string | null,
	organizationId: string,
): Promise<{ isValid: boolean; error?: string }> {
	// Get the project
	const proj = await db.query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, organizationId),
		),
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
	// Build OR condition for team assignment
	const assignmentQuery = teamId
		? or(
				and(
					eq(projectAssignment.projectId, projectId),
					eq(projectAssignment.organizationId, organizationId),
					eq(projectAssignment.employeeId, employeeId),
				),
				and(
					eq(projectAssignment.projectId, projectId),
					eq(projectAssignment.organizationId, organizationId),
					eq(projectAssignment.teamId, teamId),
				),
			)
		: and(
				eq(projectAssignment.projectId, projectId),
				eq(projectAssignment.organizationId, organizationId),
				eq(projectAssignment.employeeId, employeeId),
			);

	const assignment = await db.query.projectAssignment.findFirst({
		where: assignmentQuery,
	});

	if (!assignment) {
		return {
			isValid: false,
			error:
				"You are not assigned to this project. Contact your administrator.",
		};
	}

	return { isValid: true };
}

/**
 * Check compliance after clocking out and log any violations
 * This is a warning-only system - it logs violations but doesn't block actions
 */
export async function checkComplianceAfterClockOut(
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
			const workPolicyService = yield* _(WorkPolicyService);

			const result = yield* _(
				workPolicyService.checkCompliance({
					employeeId,
					currentSessionMinutes,
					totalDailyMinutes: timeSummary.todayMinutes,
					totalWeeklyMinutes: timeSummary.weekMinutes,
					breaksTakenMinutes: breaksTaken,
				}),
			);

			// Log violations if any
			if (result.warnings.length > 0) {
				const effectivePolicy = yield* _(
					workPolicyService.getEffectivePolicy(employeeId),
				);

				if (effectivePolicy?.regulation) {
					for (const warning of result.warnings) {
						if (warning.severity === "violation") {
							yield* _(
								workPolicyService.logViolation({
									employeeId,
									organizationId,
									policyId: effectivePolicy.policyId,
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
		}).pipe(
			Effect.provide(WorkPolicyServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

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
	const { start: todayStartDT, end: todayEndDT } =
		getTodayRangeInTimezone(timezone);
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
export async function calculateAndPersistSurcharges(
	workPeriodId: string,
	organizationId: string,
): Promise<void> {
	try {
		const surchargeEffect = Effect.gen(function* (_) {
			const surchargeService = yield* _(SurchargeService);

			// Check if surcharges are enabled for this organization
			const isEnabled = yield* _(
				surchargeService.isSurchargesEnabled(organizationId),
			);
			if (!isEnabled) {
				return;
			}

			// Persist the surcharge calculation
			yield* _(surchargeService.persistSurchargeCalculation(workPeriodId));
		}).pipe(
			Effect.provide(SurchargeServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		await Effect.runPromise(surchargeEffect);
	} catch (error) {
		// Log the error but don't fail the clock-out
		logger.error(
			{ error, workPeriodId },
			"Failed to calculate surcharges after clock-out",
		);
	}
}

/**
 * Enforce breaks after clock-out by automatically splitting work periods
 * if they violate break requirements.
 * Errors are logged but don't fail the clock-out.
 */
export async function enforceBreaksAfterClockOut(input: {
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
			Effect.provide(WorkPolicyServiceLive),
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
export async function createTimeEntry(
	params: {
		employeeId: string;
		organizationId: string;
		timestamp: Date;
		createdBy: string;
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
		notes?: string;
	} & (
		| {
				type: "correction";
				replacesEntryId: string;
				workPeriodId: string;
		  }
		| {
				type: "clock_in" | "clock_out";
				replacesEntryId?: never;
				workPeriodId?: never;
		  }
	),
	transaction?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<typeof timeEntry.$inferSelect> {
	const {
		employeeId,
		organizationId,
		type,
		timestamp,
		createdBy,
		utcOffsetMinutes,
		timezone,
		timezoneSource,
		replacesEntryId,
		workPeriodId,
		notes,
	} = params;

	// Get request metadata
	const headersList = await headers();
	const ipAddress =
		headersList.get("x-forwarded-for") ||
		headersList.get("x-real-ip") ||
		"unknown";
	const userAgent = headersList.get("user-agent") || "unknown";

	if (type === "correction") {
		const correctionInput = {
			employeeId,
			organizationId,
			replacesEntryId,
			workPeriodId,
			timestamp,
			createdBy,
			notes: notes ?? "",
			ipAddress,
			deviceInfo: userAgent,
			utcOffsetMinutes,
			timezone,
			timezoneSource,
		};
		return transaction
			? canonicalTimeEntryClient.createCorrectionEntry(
					correctionInput,
					transaction,
				)
			: canonicalTimeEntryClient.createCorrectionEntry(correctionInput);
	}

	const entryInput = {
		employeeId,
		organizationId,
		type,
		timestamp,
		createdBy,
		notes,
		ipAddress,
		deviceInfo: userAgent,
		utcOffsetMinutes,
		timezone,
		timezoneSource,
	};
	return transaction
		? canonicalTimeEntryClient.createTimeEntry(entryInput, transaction)
		: canonicalTimeEntryClient.createTimeEntry(entryInput);
}

export async function requestTimeCorrection(
	data: CorrectionRequest,
): Promise<
	ServerActionResult<{ approvalId: string; status: "approved" | "pending" }>
> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	const billingAccess = await requireBillingForMutation(emp.organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	return requestTimeCorrectionEffect(data);
}

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
			const workPolicyService = yield* _(WorkPolicyService);

			const policy = yield* _(workPolicyService.getEffectivePolicy(emp.id));

			if (!policy?.regulation) {
				return {
					needsBreakSoon: false,
					uninterruptedMinutes: currentSessionMinutes,
					maxUninterrupted: null,
					minutesUntilBreakRequired: null,
					breakRequirement: null,
				};
			}

			const { regulation } = policy;

			// Calculate break requirements
			const breakReq = workPolicyService.calculateBreakRequirements({
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
		}).pipe(
			Effect.provide(WorkPolicyServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

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
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.employeeId, emp.id),
					eq(workPeriod.organizationId, emp.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return {
				success: false,
				error: "You can only update your own work periods",
			};
		}

		// Work period must be completed (have a clock-out entry)
		if (!period.clockOutId) {
			return {
				success: false,
				error: "Cannot add notes to an active work period",
			};
		}

		const billingAccess = await requireBillingForMutation(emp.organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return {
				success: false,
				error: "billing_required",
				code: billingAccess.reason ?? "subscription_required",
			};
		}

		// Update the clock-out entry's notes
		await db
			.update(timeEntry)
			.set({ notes })
			.where(eq(timeEntry.id, period.clockOutId));

		return { success: true, data: { workPeriodId } };
	} catch (error) {
		logger.error({ error }, "Update work period notes error");
		return {
			success: false,
			error: "Failed to update notes. Please try again.",
		};
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
	void workPeriodId;
	return { success: false, error: "Deletion requires manager approval" };
}

/**
 * Split a work period into two separate periods at a given time
 * Used to divide a single work session into multiple segments with distinct descriptions
 */
export async function splitWorkPeriod(
	workPeriodId: string,
	splitDateKey: string,
	splitTime: string, // HH:mm format
	beforeNotes?: string,
	afterNotes?: string,
	disambiguation?: "earlier" | "later",
): Promise<
	ServerActionResult<{ firstPeriodId: string; secondPeriodId: string }>
> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { timezone: true },
	});
	const timezone = settingsData?.timezone || "UTC";

	try {
		// Get the work period with related entries
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.employeeId, emp.id),
					eq(workPeriod.organizationId, emp.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return {
				success: false,
				error: "You can only split your own work periods",
			};
		}

		// Work period must be completed (have an end time)
		if (!period.endTime || !period.clockOutId) {
			return { success: false, error: "Cannot split an active work period" };
		}

		const resolvedSplit = resolveWorkPeriodSplit({
			startTime: period.startTime,
			endTime: period.endTime,
			splitDate: splitDateKey,
			splitTime,
			timezone,
			disambiguation,
		});
		if (!resolvedSplit.success) {
			return {
				success: false,
				error:
					resolvedSplit.code === "ambiguous"
						? "Split time is ambiguous"
						: resolvedSplit.code === "nonexistent"
							? "Split time does not exist on this date"
							: "Split time must be between work period start and end times",
			};
		}
		const splitDate = resolvedSplit.splitTime;
		const splitTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: splitDate,
			timezone,
			timezoneSource: "user_setting",
		});

		// Validate split time is between start and end
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

		const billingAccess = await requireBillingForMutation(emp.organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return {
				success: false,
				error: "billing_required",
				code: billingAccess.reason ?? "subscription_required",
			};
		}

		// Create clock-out entry for first period at split time
		const firstClockOut = await createTimeEntry({
			employeeId: emp.id,
			organizationId: emp.organizationId,
			type: "clock_out",
			timestamp: splitDate,
			createdBy: session.user.id,
			...splitTimezoneCapture,
			notes: beforeNotes,
		});

		// Create clock-in entry for second period at split time
		const secondClockIn = await createTimeEntry({
			employeeId: emp.id,
			organizationId: emp.organizationId,
			type: "clock_in",
			timestamp: splitDate,
			createdBy: session.user.id,
			...splitTimezoneCapture,
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
		const { firstDurationMinutes, secondDurationMinutes } = resolvedSplit;

		// Update the original work period to end at split time
		await db
			.update(workPeriod)
			.set({
				clockOutId: firstClockOut.id,
				endTime: splitDate,
				durationMinutes: firstDurationMinutes,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(workPeriod.id, period.id),
					eq(workPeriod.organizationId, emp.organizationId),
					isNull(workPeriod.deletedAt),
				),
			);

		// Create a new work period for the second segment
		const [secondPeriod] = await db
			.insert(workPeriod)
			.values({
				employeeId: emp.id,
				organizationId: emp.organizationId,
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
		return {
			success: false,
			error: "Failed to split work period. Please try again.",
		};
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
		const [entry] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.id, entryId))
			.limit(1);

		if (!entry) {
			return { success: false, error: "Time entry not found" };
		}

		// Verify ownership
		if (entry.employeeId !== emp.id) {
			return {
				success: false,
				error: "You can only update your own time entries",
			};
		}

		const billingAccess = await requireBillingForMutation(emp.organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return {
				success: false,
				error: "billing_required",
				code: billingAccess.reason ?? "subscription_required",
			};
		}

		// Update the notes
		await db.update(timeEntry).set({ notes }).where(eq(timeEntry.id, entryId));

		return { success: true, data: { entryId } };
	} catch (error) {
		logger.error({ error }, "Update time entry notes error");
		return {
			success: false,
			error: "Failed to update notes. Please try again.",
		};
	}
}

export interface AssignedProject {
	id: string;
	name: string;
	color: string | null;
	status: string;
	budgetHours: number | null;
	deadline: string | null; // ISO string for serialization
	totalHoursBooked: number;
}

/**
 * Get all projects the current employee can book time to
 * Returns projects that:
 * - Are in bookable status (planned, active, paused)
 * - The employee is assigned to (directly or via team)
 */
export async function getAssignedProjects(): Promise<
	ServerActionResult<AssignedProject[]>
> {
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
		const bookableProjects = new Map<
			string,
			{
				id: string;
				name: string;
				color: string | null;
				status: string;
				budgetHours: string | null;
				deadline: Date | null;
			}
		>();

		const typedAssignments = [
			...directAssignments,
			...teamAssignments,
		] as unknown as ProjectAssignmentWithProject[];

		for (const assignment of typedAssignments) {
			const proj = assignment.project;
			if (
				proj &&
				bookableStatuses.includes(proj.status) &&
				!bookableProjects.has(proj.id)
			) {
				bookableProjects.set(proj.id, {
					id: proj.id,
					name: proj.name,
					color: proj.color,
					status: proj.status,
					budgetHours: proj.budgetHours,
					deadline: proj.deadline,
				});
			}
		}

		// Batch query: get total hours booked per project in one query
		const projectIds = Array.from(bookableProjects.keys());
		const hoursMap = new Map<string, number>();

		if (projectIds.length > 0) {
			const hoursResult = await db
				.select({
					projectId: workPeriod.projectId,
					totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
				})
				.from(workPeriod)
				.where(
					and(
						inArray(workPeriod.projectId, projectIds),
						eq(workPeriod.organizationId, emp.organizationId),
					),
				)
				.groupBy(workPeriod.projectId);

			for (const row of hoursResult) {
				if (row.projectId) {
					hoursMap.set(row.projectId, row.totalMinutes / 60);
				}
			}
		}

		// Build final result with budget/deadline data
		const projectsMap = new Map<string, AssignedProject>();
		for (const proj of bookableProjects.values()) {
			projectsMap.set(proj.id, {
				id: proj.id,
				name: proj.name,
				color: proj.color,
				status: proj.status,
				budgetHours: proj.budgetHours ? Number(proj.budgetHours) : null,
				deadline: proj.deadline?.toISOString() ?? null,
				totalHoursBooked: hoursMap.get(proj.id) ?? 0,
			});
		}

		// Sort by name
		const projects = Array.from(projectsMap.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		);

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
): Promise<
	ServerActionResult<{ workPeriodId: string; projectId: string | null }>
> {
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
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.employeeId, emp.id),
					eq(workPeriod.organizationId, emp.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);

		if (!period) {
			return { success: false, error: "Work period not found" };
		}

		// Verify ownership
		if (period.employeeId !== emp.id) {
			return {
				success: false,
				error: "You can only update your own work periods",
			};
		}

		// Validate project if provided
		if (projectId) {
			const projectValidation = await validateProjectAssignment(
				projectId,
				emp.id,
				emp.teamId,
				emp.organizationId,
			);
			if (!projectValidation.isValid) {
				return {
					success: false,
					error: projectValidation.error || "Cannot assign to this project",
				};
			}
		}

		const billingAccess = await requireBillingForMutation(emp.organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return {
				success: false,
				error: "billing_required",
				code: billingAccess.reason ?? "subscription_required",
			};
		}

		// Update the work period
		await db
			.update(workPeriod)
			.set({
				projectId: projectId,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.organizationId, emp.organizationId),
					isNull(workPeriod.deletedAt),
				),
			);

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
		return {
			success: false,
			error: "You can only check your own work periods",
		};
	}

	// Work period must be completed
	if (!period.endTime) {
		return {
			success: true,
			data: {
				capability: {
					type: "forbidden",
					reason: "beyond_approval_window",
					daysBack: 0,
				},
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
			}).pipe(
				Effect.provide(ChangePolicyServiceLive),
				Effect.provide(DatabaseServiceLive),
			),
		);

		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to get edit capability");
		return { success: false, error: "Failed to check edit permissions" };
	}
}

/**
 * Create a manual time entry for a past date
 * Respects the organization's change policy for approval requirements
 */
export async function createManualTimeEntry(
	data: ManualTimeEntryInput,
): Promise<
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
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await getCurrentEmployee();
	if (!emp) {
		return { success: false, error: "Employee profile not found" };
	}

	const billingAccess = await requireBillingForMutation(emp.organizationId);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	return createManualTimeEntryModular(data);
}

/**
 * Get presence status for an employee
 * Returns on-site requirement progress for the current evaluation period
 */
export async function getPresenceStatus(
	employeeId: string,
): Promise<ServerActionResult<PresenceStatusSummary>> {
	const parsed = z
		.object({ employeeId: z.uuid("Invalid employee ID") })
		.safeParse({ employeeId });
	if (!parsed.success) {
		return {
			success: false as const,
			error: parsed.error.issues[0]?.message || "Invalid input",
		};
	}
	const validatedEmployeeId = parsed.data.employeeId;
	const disabledPresenceStatus = (message: string): PresenceStatusSummary => ({
		presenceEnabled: false,
		available: false,
		period: "weekly",
		periodStart: "",
		periodEnd: "",
		mode: "minimum_count",
		homeOfficeDaysLeft: 0,
		officeDaysRequiredLeft: 0,
		officeDaysCompleted: 0,
		homeOfficeDaysUsed: 0,
		workingDaysRemaining: 0,
		requiredOfficeDays: 0,
		fixedOfficeDays: [],
		message,
	});

	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Require an active organization
		if (!session.session.activeOrganizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "No active organization",
						userId: session.user.id,
						resource: "employee",
						action: "getPresenceStatus",
					}),
				),
			);
		}

		// Verify the employee belongs to the caller's active organization
		const targetEmployee = yield* _(
			dbService.query("getEmployeeForAuth", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, validatedEmployeeId),
						eq(employee.organizationId, session.session.activeOrganizationId!),
					),
					columns: { id: true },
				});
			}),
		);

		if (!targetEmployee) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Employee not found in your organization",
						userId: session.user.id,
						resource: "employee",
						action: "getPresenceStatus",
					}),
				),
			);
		}

		// Get employee's effective work policy
		const workPolicyService = yield* _(WorkPolicyService);
		const effectivePolicy = yield* _(
			workPolicyService.getEffectivePolicy(validatedEmployeeId),
		);

		if (!effectivePolicy) {
			return disabledPresenceStatus("No effective work policy found.");
		}

		// Check if presence is enabled on the policy
		const policyRow = yield* _(
			dbService.query("getWorkPolicy", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: and(
						eq(workPolicy.id, effectivePolicy.policyId),
						eq(
							workPolicy.organizationId,
							session.session.activeOrganizationId!,
						),
					),
					columns: { presenceEnabled: true },
				});
			}),
		);

		if (!policyRow?.presenceEnabled) {
			return disabledPresenceStatus("Presence policy is not enabled.");
		}

		// Load presence config
		const presenceConfig = yield* _(
			dbService.query("getPresenceConfig", async () => {
				return await dbService.db.query.workPolicyPresence.findFirst({
					where: eq(workPolicyPresence.policyId, effectivePolicy.policyId),
				});
			}),
		);

		if (!presenceConfig) {
			return disabledPresenceStatus(
				"Presence policy configuration is missing.",
			);
		}

		const now = DateTime.now();
		const weekStartDay = yield* _(
			Effect.promise(() => getUserWeekStartDay(session.user.id)),
		);
		const settingsData = yield* _(
			dbService.query("getUserTimezone", async () => {
				return await dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
					columns: { timezone: true },
				});
			}),
		);
		const timezone = settingsData?.timezone || "UTC";
		const { start: periodStart, end: periodEnd } = getPresencePeriodBounds({
			period: presenceConfig.evaluationPeriod,
			now,
			weekStartDay,
			timezone,
		});

		const fixedOfficeDays = presenceConfig.requiredOnsiteFixedDays
			? parsePresenceFixedDays(presenceConfig.requiredOnsiteFixedDays)
			: null;

		if (presenceConfig.requiredOnsiteFixedDays && fixedOfficeDays === null) {
			return {
				presenceEnabled: true,
				available: false,
				period: presenceConfig.evaluationPeriod as PresenceEvaluationPeriod,
				periodStart: periodStart.toISO() ?? "",
				periodEnd: periodEnd.toISO() ?? "",
				mode: presenceConfig.presenceMode,
				homeOfficeDaysLeft: 0,
				officeDaysRequiredLeft: 0,
				officeDaysCompleted: 0,
				homeOfficeDaysUsed: 0,
				workingDaysRemaining: 0,
				requiredOfficeDays: 0,
				fixedOfficeDays: [],
				message: "Presence policy has invalid fixed office days.",
			};
		}

		const fixedDaysConfigMessage = validatePresenceFixedDaysConfig(
			presenceConfig.presenceMode,
			fixedOfficeDays,
		);
		if (fixedDaysConfigMessage) {
			return {
				presenceEnabled: true,
				available: false,
				period: presenceConfig.evaluationPeriod as PresenceEvaluationPeriod,
				periodStart: periodStart.toISO() ?? "",
				periodEnd: periodEnd.toISO() ?? "",
				mode: presenceConfig.presenceMode,
				homeOfficeDaysLeft: 0,
				officeDaysRequiredLeft: 0,
				officeDaysCompleted: 0,
				homeOfficeDaysUsed: 0,
				workingDaysRemaining: 0,
				requiredOfficeDays: 0,
				fixedOfficeDays: [],
				message: fixedDaysConfigMessage,
			};
		}

		const periods = yield* _(
			dbService.query("getPresenceWorkPeriods", async () => {
				return await dbService.db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.employeeId, validatedEmployeeId),
						eq(
							workPeriod.organizationId,
							session.session.activeOrganizationId!,
						),
						gte(workPeriod.startTime, periodStart.toJSDate()),
						lte(workPeriod.startTime, periodEnd.toJSDate()),
					),
					columns: { startTime: true, workLocationType: true },
				});
			}),
		);
		const periodStartDate = periodStart.toISODate() ?? "";
		const periodEndDate = periodEnd.toISODate() ?? "";

		const approvedHomeOfficeEntries = yield* _(
			dbService.query("getApprovedHomeOfficeEntries", async () => {
				return await dbService.db
					.select({
						startDate: absenceEntry.startDate,
						endDate: absenceEntry.endDate,
					})
					.from(absenceEntry)
					.innerJoin(
						absenceCategory,
						eq(absenceEntry.categoryId, absenceCategory.id),
					)
					.where(
						and(
							eq(absenceEntry.employeeId, validatedEmployeeId),
							eq(
								absenceEntry.organizationId,
								session.session.activeOrganizationId!,
							),
							eq(absenceEntry.status, "approved"),
							eq(
								absenceCategory.organizationId,
								session.session.activeOrganizationId!,
							),
							eq(absenceCategory.type, "home_office"),
							lte(absenceEntry.startDate, periodEndDate),
							gte(absenceEntry.endDate, periodStartDate),
						),
					);
			}),
		);

		const approvedHomeOfficeDates = expandApprovedHomeOfficeDates({
			entries: approvedHomeOfficeEntries,
			periodStart,
			periodEnd,
			timezone,
		});

		return calculatePresenceStatusSummary({
			presenceMode: presenceConfig.presenceMode,
			requiredOnsiteDays: presenceConfig.requiredOnsiteDays,
			requiredOnsiteFixedDays: fixedOfficeDays,
			period: presenceConfig.evaluationPeriod,
			periodStart,
			periodEnd,
			now,
			timezone,
			workDays: getPresenceWorkDays(effectivePolicy.schedule?.days ?? null),
			workPeriods: periods,
			approvedHomeOfficeDates,
		});
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
