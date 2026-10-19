import { and, eq, gte, isNotNull, lt, lte, min } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeEmploymentHistory,
	shift,
	workPeriod,
	workPolicy,
} from "@/db/schema";
import { absenceCategoryReleasesRequiredTime } from "@/lib/absences/required-time-release";
import {
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import {
	type DatabaseClient,
	DatabaseService,
	makeDatabaseService,
} from "@/lib/effect/services/database.service";
import {
	type EffectiveWorkPolicy,
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { clipRequirementsToEmployment } from "@/lib/employee-lifecycle/employment-coverage";
import { loadEmploymentCoverage } from "@/lib/employee-lifecycle/employment-periods";
import { loadConfirmedTermsSpans } from "@/lib/employment-history/load-terms-in-force";
import {
	type CalendarDateRange,
	clipTermsSpans,
} from "@/lib/employment-history/terms-in-force";
import {
	shiftCalendarDate,
	shiftDateRangeBounds,
} from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";
import {
	type ApprovedAbsenceRange,
	applyAbsenceAdjustmentsToRequirements,
} from "./absence-adjusted-requirements";
import {
	applyAssignedHolidayAdjustmentsToRequirements,
	getAssignedHolidaysForEmployee,
} from "./assigned-holidays";
import type { DailyWorkRequirements } from "./types";

type EffectiveWorkPolicyScheduleDayName = NonNullable<
	EffectiveWorkPolicy["schedule"]
>["days"][number]["dayOfWeek"];

const WEEKDAY_BY_NUMBER: Record<number, EffectiveWorkPolicyScheduleDayName> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

const PRESET_DAYS: Record<string, EffectiveWorkPolicyScheduleDayName[]> = {
	weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
	weekends: ["saturday", "sunday"],
	all_days: [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	],
};

interface BuildDailyWorkRequirementsOptions {
	policy: EffectiveWorkPolicy | null;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
	weeklyContractMinutes?: number | null;
}

interface ShiftRequirementSource {
	date: Date;
	startTime: string;
	endTime: string;
}

interface BuildShiftDailyWorkRequirementsOptions {
	shifts: ShiftRequirementSource[];
	/** The organization's timezone, which `shift.date` and the wall times are read in. */
	organizationTimezone: string;
}

type PolicyWithDetails = typeof workPolicy.$inferSelect & {
	schedule: {
		scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
		scheduleType: "simple" | "detailed";
		workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
		hoursPerCycle: string | null;
		homeOfficeDaysPerCycle: number | null;
		days: Array<{
			dayOfWeek: EffectiveWorkPolicyScheduleDayName;
			hoursPerDay: string;
			isWorkDay: boolean;
			latestClockIn: string | null;
		}>;
	} | null;
};

function hoursToMinutes(hours: string | null | undefined): number {
	const parsed = Number.parseFloat(hours ?? "");
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.round(parsed * 60);
}

function getSimpleWorkDays(
	schedule: NonNullable<EffectiveWorkPolicy["schedule"]>,
): EffectiveWorkPolicyScheduleDayName[] {
	if (schedule.workingDaysPreset === "custom") {
		return schedule.days.flatMap((day) =>
			day.isWorkDay ? [day.dayOfWeek] : [],
		);
	}

	return PRESET_DAYS[schedule.workingDaysPreset] ?? [];
}

function getRequiredMinutesForDay(
	policy: EffectiveWorkPolicy,
	dayName: EffectiveWorkPolicyScheduleDayName,
	weeklyContractMinutes?: number | null,
): number {
	const schedule = policy.schedule;
	if (!schedule) return 0;

	if (schedule.scheduleType === "detailed") {
		if (schedule.scheduleCycle !== "weekly") return 0;

		const configuredDay = schedule.days.find(
			(day) => day.dayOfWeek === dayName && day.isWorkDay,
		);
		return hoursToMinutes(configuredDay?.hoursPerDay);
	}

	if (schedule.scheduleType === "simple") {
		if (schedule.scheduleCycle !== "weekly") return 0;

		const workDays = getSimpleWorkDays(schedule);
		if (!workDays.includes(dayName) || workDays.length === 0) return 0;

		const cycleMinutes =
			weeklyContractMinutes ?? hoursToMinutes(schedule.hoursPerCycle);
		return cycleMinutes > 0 ? Math.round(cycleMinutes / workDays.length) : 0;
	}

	return 0;
}

export function buildDailyWorkRequirements({
	policy,
	startDate,
	endDate,
	timezone,
	weeklyContractMinutes,
}: BuildDailyWorkRequirementsOptions): DailyWorkRequirements {
	if (!policy?.schedule) return {};

	const requestedZone = timezone || "utc";
	const zonedStart = DateTime.fromJSDate(startDate, { zone: "utc" }).setZone(
		requestedZone,
	);
	const zonedEnd = DateTime.fromJSDate(endDate, { zone: "utc" }).setZone(
		requestedZone,
	);
	const start = (
		zonedStart.isValid
			? zonedStart
			: DateTime.fromJSDate(startDate, { zone: "utc" })
	).startOf("day");
	const end = (
		zonedEnd.isValid ? zonedEnd : DateTime.fromJSDate(endDate, { zone: "utc" })
	).startOf("day");
	if (!start.isValid || !end.isValid || end < start) return {};

	const requirements: DailyWorkRequirements = {};

	for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
		const dayName = WEEKDAY_BY_NUMBER[cursor.weekday];
		const requiredMinutes = getRequiredMinutesForDay(
			policy,
			dayName,
			weeklyContractMinutes,
		);
		if (requiredMinutes <= 0) continue;

		requirements[cursor.toFormat("yyyy-MM-dd")] = {
			requiredMinutes,
			policyId: policy.policyId,
			policyName: policy.policyName,
		};
	}

	return requirements;
}

function mergeDailyWorkRequirements(
	target: DailyWorkRequirements,
	source: DailyWorkRequirements,
): DailyWorkRequirements {
	for (const [dateKey, requirement] of Object.entries(source)) {
		const existing = target[dateKey];
		target[dateKey] = existing
			? {
					requiredMinutes:
						existing.requiredMinutes + requirement.requiredMinutes,
					policyId: requirement.policyId,
					policyName: requirement.policyName,
				}
			: requirement;
	}

	return target;
}

function mapPolicyToEffective(policy: PolicyWithDetails): EffectiveWorkPolicy {
	return {
		policyId: policy.id,
		policyName: policy.name,
		schedule:
			policy.scheduleEnabled && policy.schedule
				? {
						scheduleCycle: policy.schedule.scheduleCycle,
						scheduleType: policy.schedule.scheduleType,
						workingDaysPreset: policy.schedule.workingDaysPreset,
						hoursPerCycle: policy.schedule.hoursPerCycle,
						homeOfficeDaysPerCycle: policy.schedule.homeOfficeDaysPerCycle ?? 0,
						days: policy.schedule.days.map((day) => ({
							dayOfWeek: day.dayOfWeek,
							hoursPerDay: day.hoursPerDay,
							isWorkDay: day.isWorkDay,
							latestClockIn: day.latestClockIn ?? null,
						})),
					}
				: null,
		regulation: null,
		assignmentType: "employee",
		assignedVia: "Contract override",
	};
}

export function buildShiftDailyWorkRequirements({
	shifts,
	organizationTimezone,
}: BuildShiftDailyWorkRequirementsOptions): DailyWorkRequirements {
	const requirements: DailyWorkRequirements = {};

	for (const assignedShift of shifts) {
		const date = shiftCalendarDate(assignedShift.date, organizationTimezone);
		const dateKey = date.toString();
		const interval = shiftInterval(
			{
				date,
				startTime: assignedShift.startTime,
				endTime: assignedShift.endTime,
			},
			organizationTimezone,
		);
		const requiredMinutes = Math.round(
			interval.start.until(interval.end).total({ unit: "minutes" }),
		);
		if (requiredMinutes <= 0) continue;

		const existing = requirements[dateKey]?.requiredMinutes ?? 0;
		requirements[dateKey] = {
			requiredMinutes: existing + requiredMinutes,
			policyId: "assigned-shift",
			policyName: "Assigned shift",
		};
	}

	return requirements;
}

export function applyApprovedAbsencesToDailyRequirements(
	requirements: DailyWorkRequirements,
	absences: ApprovedAbsenceRange[],
): DailyWorkRequirements {
	return applyAbsenceAdjustmentsToRequirements(requirements, absences);
}

async function getApprovedAbsenceRanges(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
}): Promise<ApprovedAbsenceRange[]> {
	const requestedZone = params.timezone || "utc";
	const zonedStart = DateTime.fromJSDate(params.startDate, {
		zone: "utc",
	}).setZone(requestedZone);
	const zonedEnd = DateTime.fromJSDate(params.endDate, { zone: "utc" }).setZone(
		requestedZone,
	);
	const start = (
		zonedStart.isValid
			? zonedStart
			: DateTime.fromJSDate(params.startDate, { zone: "utc" })
	).toFormat("yyyy-MM-dd");
	const end = (
		zonedEnd.isValid
			? zonedEnd
			: DateTime.fromJSDate(params.endDate, { zone: "utc" })
	).toFormat("yyyy-MM-dd");

	return Effect.runPromise(
		params.database.query(
			"getApprovedAbsencesForCalendarRequirements",
			async () => {
				return params.database.db
					.select({
						startDate: absenceEntry.startDate,
						startPeriod: absenceEntry.startPeriod,
						endDate: absenceEntry.endDate,
						endPeriod: absenceEntry.endPeriod,
					})
					.from(absenceEntry)
					.innerJoin(
						absenceCategory,
						eq(absenceEntry.categoryId, absenceCategory.id),
					)
					.where(
						and(
							eq(absenceEntry.employeeId, params.employeeId),
							eq(absenceEntry.organizationId, params.organizationId),
							eq(absenceEntry.status, "approved"),
							eq(absenceCategory.organizationId, params.organizationId),
							absenceCategoryReleasesRequiredTime(),
							lte(absenceEntry.startDate, end),
							gte(absenceEntry.endDate, start),
						),
					);
			},
		),
	);
}

/**
 * Requirements from the employee's published shifts on the calendar days from `startDate`'s
 * through `endDate`'s in the requested zone. Shifts are matched to those days by their
 * organization-local date.
 */
export async function getPublishedShiftRequirementsForEmployee(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
}): Promise<DailyWorkRequirements> {
	const requestedZone =
		params.timezone && isValidIanaTimeZone(params.timezone)
			? params.timezone
			: "UTC";
	const firstDay = plainDateAt(
		instantFromDate(params.startDate),
		requestedZone,
	);
	const lastDay = plainDateAt(instantFromDate(params.endDate), requestedZone);
	if (comparePlainDates(firstDay, lastDay) > 0) return {};

	const assignedShifts = await Effect.runPromise(
		params.database.query(
			"getPublishedShiftsForCalendarRequirements",
			async () => {
				const organizationTimezone = await loadOrganizationTimezone(
					params.database.db,
					params.organizationId,
				);
				const bounds = shiftDateRangeBounds(
					firstDay,
					lastDay.add({ days: 1 }),
					organizationTimezone,
				);
				const shifts = await params.database.db
					.select({
						date: shift.date,
						startTime: shift.startTime,
						endTime: shift.endTime,
					})
					.from(shift)
					.where(
						and(
							eq(shift.employeeId, params.employeeId),
							eq(shift.organizationId, params.organizationId),
							eq(shift.status, "published"),
							gte(shift.date, bounds.start),
							lt(shift.date, bounds.endExclusive),
						),
					);
				return { organizationTimezone, shifts };
			},
		),
	);

	return buildShiftDailyWorkRequirements({
		shifts: assignedShifts.shifts,
		organizationTimezone: assignedShifts.organizationTimezone,
	});
}

async function getEmploymentHistoryWorkPolicy(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	policyId: string;
}): Promise<EffectiveWorkPolicy | null> {
	const policy = await Effect.runPromise(
		params.database.query("getEmploymentHistoryRequirementPolicy", async () => {
			return params.database.db.query.workPolicy.findFirst({
				where: and(
					eq(workPolicy.id, params.policyId),
					eq(workPolicy.organizationId, params.organizationId),
					eq(workPolicy.isActive, true),
				),
				with: {
					schedule: { with: { days: true } },
				},
			});
		}),
	);

	return policy ? mapPolicyToEffective(policy as PolicyWithDetails) : null;
}

async function buildEmploymentHistoryDailyRequirements(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
	fallbackPolicy: EffectiveWorkPolicy | null;
}): Promise<DailyWorkRequirements | null> {
	const timezone =
		params.timezone && isValidIanaTimeZone(params.timezone)
			? params.timezone
			: "UTC";
	const range: CalendarDateRange = {
		from: plainDateAt(instantFromDate(params.startDate), timezone),
		toExclusive: plainDateAt(instantFromDate(params.endDate), timezone).add({
			days: 1,
		}),
	};
	const spans = await Effect.runPromise(
		params.database.query("getConfirmedEmploymentRequirementSlices", () =>
			loadConfirmedTermsSpans(params.database.db, {
				organizationId: params.organizationId,
				employeeId: params.employeeId,
				range,
				timezone,
			}),
		),
	);
	if (spans.length === 0) {
		// Only employees without confirmed terms use the legacy policy fallback.
		// A gap in an established terms timeline must not manufacture required time.
		const anyTerms = await Effect.runPromise(
			params.database.query("calendarRequirements.hasConfirmedTerms", () =>
				params.database.db.query.employeeEmploymentHistory.findFirst({
					where: and(
						eq(employeeEmploymentHistory.organizationId, params.organizationId),
						eq(employeeEmploymentHistory.employeeId, params.employeeId),
						eq(employeeEmploymentHistory.reviewState, "confirmed"),
					),
					columns: { id: true },
				}),
			),
		);
		return anyTerms ? {} : null;
	}

	const requirements: DailyWorkRequirements = {};
	const sliceRequirements = await Promise.all(
		clipTermsSpans(spans, range).map(async ({ terms: slice, from, until }) => {
			// Resolve calendar ownership before converting back to reader boundary instants.
			const start = dateFromInstant(from.toZonedDateTime(timezone).toInstant());
			const end = dateFromInstant(
				(until ?? range.toExclusive)
					.subtract({ days: 1 })
					.toZonedDateTime(timezone)
					.toInstant(),
			);

			if (slice.contractType === "hourly") {
				return getPublishedShiftRequirementsForEmployee({
					database: params.database,
					organizationId: params.organizationId,
					employeeId: params.employeeId,
					startDate: start,
					endDate: end,
					timezone,
				});
			}

			const policy = slice.workPolicyId
				? await getEmploymentHistoryWorkPolicy({
						database: params.database,
						organizationId: params.organizationId,
						policyId: slice.workPolicyId,
					})
				: params.fallbackPolicy;

			return buildDailyWorkRequirements({
				policy,
				startDate: start,
				endDate: end,
				timezone,
				weeklyContractMinutes: slice.weeklyContractMinutes,
			});
		}),
	);

	for (const sliceRequirement of sliceRequirements) {
		if (sliceRequirement)
			mergeDailyWorkRequirements(requirements, sliceRequirement);
	}

	return requirements;
}

async function getFirstCompletedWorkPeriodBeforeAccount(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	accountCreatedAt: Date;
}): Promise<Date | null> {
	const [row] = await Effect.runPromise(
		params.database.query(
			"getFirstCompletedWorkPeriodBeforeAccount",
			async () => {
				return params.database.db
					.select({ value: min(workPeriod.startTime) })
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.employeeId, params.employeeId),
							eq(workPeriod.organizationId, params.organizationId),
							isNotNull(workPeriod.endTime),
							isNotNull(workPeriod.durationMinutes),
							lt(workPeriod.startTime, params.accountCreatedAt),
						),
					);
			},
		),
	);

	return row?.value ?? null;
}

type DailyWorkRequirementsParams = {
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
	trackingStartDateOverride?: string | null;
	employeeTrackingStartDateOverride?: string | null;
	employeeEmploymentStartDateOverride?: string;
	employeeTimezoneOverride?: string;
};

/**
 * The employee's daily work requirements from `startDate`'s day through `endDate`'s, as an effect
 * on the caller's `DatabaseService` and `WorkPolicyService`.
 */
export function loadDailyWorkRequirementsForEmployee(
	params: DailyWorkRequirementsParams,
) {
	return Effect.gen(function* () {
		const database = yield* DatabaseService;
		const scopedEmployee = yield* database.query(
			"getEmployeeForCalendarRequirements",
			async () => {
				return database.db.query.employee.findFirst({
					where: and(
						eq(employee.id, params.employeeId),
						eq(employee.organizationId, params.organizationId),
					),
					columns: { id: true, startDate: true, contractType: true },
					with: {
						user: { columns: { createdAt: true } },
						userSettings: { columns: { timezone: true } },
						organization: { columns: { timezone: true } },
					},
				});
			},
		);
		if (!scopedEmployee) return {};
		params = {
			...params,
			timezone:
				params.employeeTimezoneOverride ??
				resolveEffectiveTimezone(
					scopedEmployee.userSettings?.timezone,
					scopedEmployee.organization?.timezone,
				),
		};

		// This is the balance requirement projection. Historical policy-at-date and published
		// shift readers above remain unbounded, so rollout never rewrites schedule history.
		const tracking = yield* database.query("tracking.employeeStart", () =>
			loadEmployeeTrackingContext(database.db, params),
		);
		if (tracking) params = { ...params, timezone: tracking.timezone };
		const requestedStartDate = DateTime.fromJSDate(params.startDate, {
			zone: "utc",
		});
		const accountCreatedDate = DateTime.fromJSDate(
			scopedEmployee.user.createdAt,
			{
				zone: "utc",
			},
		);
		const firstCompletedWorkPeriodBeforeAccount = tracking
			? null
			: yield* Effect.promise(() =>
					getFirstCompletedWorkPeriodBeforeAccount({
						database,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						accountCreatedAt: scopedEmployee.user.createdAt,
					}),
				);
		const employeeStartDate = params.employeeEmploymentStartDateOverride
			? DateTime.fromISO(params.employeeEmploymentStartDateOverride, {
					zone: "utc",
				})
			: scopedEmployee.startDate
				? DateTime.fromJSDate(scopedEmployee.startDate, { zone: "utc" })
				: accountCreatedDate;
		const normalStartDate = DateTime.max(accountCreatedDate, employeeStartDate);
		const lowerBoundDate = tracking
			? DateTime.fromJSDate(
					dateFromInstant(
						parsePlainDate(tracking.startDate)
							.toZonedDateTime(tracking.timezone)
							.toInstant(),
					),
					{ zone: "utc" },
				)
			: firstCompletedWorkPeriodBeforeAccount
				? DateTime.min(
						DateTime.fromJSDate(firstCompletedWorkPeriodBeforeAccount, {
							zone: "utc",
						}),
						normalStartDate,
					)
				: normalStartDate;
		const effectiveStartDate = DateTime.max(
			requestedStartDate,
			lowerBoundDate,
		).toJSDate();
		if (effectiveStartDate > params.endDate) return {};

		const service = yield* WorkPolicyService;
		const fallbackPolicy = yield* service.getEffectivePolicy(params.employeeId);
		const historyRequirements = yield* Effect.promise(() =>
			buildEmploymentHistoryDailyRequirements({
				database,
				organizationId: params.organizationId,
				employeeId: params.employeeId,
				startDate: effectiveStartDate,
				endDate: params.endDate,
				timezone: params.timezone,
				fallbackPolicy,
			}),
		);
		const requirements =
			historyRequirements ??
			(scopedEmployee.contractType === "hourly"
				? yield* Effect.promise(() =>
						getPublishedShiftRequirementsForEmployee({
							database,
							organizationId: params.organizationId,
							employeeId: params.employeeId,
							startDate: effectiveStartDate,
							endDate: params.endDate,
							timezone: params.timezone,
						}),
					)
				: buildDailyWorkRequirements({
						policy: fallbackPolicy,
						startDate: effectiveStartDate,
						endDate: params.endDate,
						timezone: params.timezone,
					}));
		const approvedAbsences = yield* Effect.promise(() =>
			getApprovedAbsenceRanges({
				database,
				organizationId: params.organizationId,
				employeeId: params.employeeId,
				startDate: effectiveStartDate,
				endDate: params.endDate,
				timezone: params.timezone,
			}),
		);

		// Days outside employment (after a departure, or between stints) require nothing.
		const employmentCoverage = yield* database.query(
			"getEmploymentCoverageForRequirements",
			() =>
				loadEmploymentCoverage(database.db, {
					employeeEmploymentStartDateOverride:
						params.employeeEmploymentStartDateOverride,
					organizationId: params.organizationId,
					employeeId: params.employeeId,
				}),
		);
		const employedRequirements = clipRequirementsToEmployment(
			requirements,
			employmentCoverage,
			params.timezone,
		);

		// biome-ignore format: existing regression contract matches the call sequence.
		const absenceAdjustedRequirements = applyApprovedAbsencesToDailyRequirements(
				employedRequirements,
				approvedAbsences,
			);
		const assignedHolidays = yield* Effect.promise(() =>
			getAssignedHolidaysForEmployee({
				organizationId: params.organizationId,
				employeeId: params.employeeId,
				startDate: effectiveStartDate,
				endDate: params.endDate,
			}),
		);

		// biome-ignore format: source-level regression test asserts this call order.
		return applyAssignedHolidayAdjustmentsToRequirements(absenceAdjustedRequirements, assignedHolidays);
	});
}

export async function getDailyWorkRequirementsForEmployee(
	params: DailyWorkRequirementsParams,
	dbClient?: WorkBalanceDbClient,
): Promise<DailyWorkRequirements> {
	const effect = loadDailyWorkRequirementsForEmployee(params);
	if (!dbClient) return runtime.runPromise(effect);
	// A caller's preview transaction must see its own policy and date inputs.
	// Rebuild the policy layer locally rather than reusing the shared runtime instance.
	return runtime.runPromise(
		effect.pipe(
			Effect.provide(WorkPolicyServiceLive, { local: true }),
			Effect.provideService(
				DatabaseService,
				makeDatabaseService(dbClient as DatabaseClient),
			),
		),
	);
}
