import { and, eq, gte, isNotNull, lt, lte, min } from "drizzle-orm";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import {
	absenceCategory,
	absenceEntry,
	employee,
	shift,
	workPeriod,
	type workPolicy,
} from "@/db/schema";
import { absenceCategoryReleasesRequiredTime } from "@/lib/absences/required-time-release";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import {
	comparePlainDates,
	dateFromInstant,
	earlierInstant,
	type Instant,
	instantFromDate,
	laterInstant,
	parseInstant,
	type PlainDate,
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
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import {
	clipRequirementsToEmployment,
	type EmploymentInterval,
} from "@/lib/employee-lifecycle/employment-coverage";
import { loadEmploymentCoverage } from "@/lib/employee-lifecycle/employment-periods";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import {
	type ApprenticeReleaseDay,
	applyApprenticeReleaseCredits,
} from "@/lib/statutory/apprenticeship/release-credits";
import { loadApprenticeReleaseDays } from "@/lib/statutory/apprenticeship/release-facts";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import {
	type EmployeeTrackingContext,
	loadEmployeeTrackingContext,
} from "@/lib/time-tracking/tracking-start";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { isValidIanaTimeZone, isValidTimeZone } from "@/lib/timezone/validation";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";
import {
	type ApprovedAbsenceRange,
	applyAbsenceAdjustmentsToRequirements,
} from "./absence-adjusted-requirements";
import {
	type AssignedHolidayRange,
	applyAssignedHolidayAdjustmentsToRequirements,
	getAssignedHolidaysForEmployee,
} from "./assigned-holidays";
import { attachTrustBasedBalanceDates, preserveTrustBasedBalanceDates } from "./trust-based-dates";
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
	all_days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
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
		return schedule.days.flatMap((day) => (day.isWorkDay ? [day.dayOfWeek] : []));
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

		const configuredDay = schedule.days.find((day) => day.dayOfWeek === dayName && day.isWorkDay);
		return hoursToMinutes(configuredDay?.hoursPerDay);
	}

	if (schedule.scheduleType === "simple") {
		if (schedule.scheduleCycle !== "weekly") return 0;

		const workDays = getSimpleWorkDays(schedule);
		if (!workDays.includes(dayName) || workDays.length === 0) return 0;

		const cycleMinutes = weeklyContractMinutes ?? hoursToMinutes(schedule.hoursPerCycle);
		return cycleMinutes > 0 ? Math.round(cycleMinutes / workDays.length) : 0;
	}

	return 0;
}

function resolveRequirementZone(timezone: string | null | undefined): string {
	return timezone && isValidTimeZone(timezone) ? timezone : "UTC";
}

function parseUtcDateOrInstant(value: string): Instant {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return parsePlainDate(value).toZonedDateTime("UTC").toInstant();
	}
	try {
		return parseInstant(value);
	} catch {
		return Temporal.PlainDateTime.from(value).toZonedDateTime("UTC").toInstant();
	}
}

export function buildDailyWorkRequirements({
	policy,
	startDate,
	endDate,
	timezone,
	weeklyContractMinutes,
}: BuildDailyWorkRequirementsOptions): DailyWorkRequirements {
	if (!policy?.schedule) return {};

	const zone = resolveRequirementZone(timezone);
	let start: Temporal.PlainDate;
	let end: Temporal.PlainDate;
	try {
		start = plainDateAt(instantFromDate(startDate), zone);
		end = plainDateAt(instantFromDate(endDate), zone);
	} catch {
		return {};
	}
	if (comparePlainDates(end, start) < 0) return {};

	const requirements: DailyWorkRequirements = {};

	for (let cursor = start; comparePlainDates(cursor, end) <= 0; cursor = cursor.add({ days: 1 })) {
		const dayName = WEEKDAY_BY_NUMBER[cursor.dayOfWeek];
		const requiredMinutes = getRequiredMinutesForDay(policy, dayName, weeklyContractMinutes);
		if (requiredMinutes <= 0) continue;

		requirements[cursor.toString()] = {
			requiredMinutes,
			policyId: policy.policyId,
			policyName: policy.policyName,
		};
	}

	return requirements;
}

export function mapPolicyToEffective(policy: PolicyWithDetails): EffectiveWorkPolicy {
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
	const zone = resolveRequirementZone(params.timezone);
	const start = plainDateAt(instantFromDate(params.startDate), zone).toString();
	const end = plainDateAt(instantFromDate(params.endDate), zone).toString();

	return Effect.runPromise(
		params.database.query("getApprovedAbsencesForCalendarRequirements", async () => {
			return params.database.db
				.select({
					startDate: absenceEntry.startDate,
					startPeriod: absenceEntry.startPeriod,
					endDate: absenceEntry.endDate,
					endPeriod: absenceEntry.endPeriod,
				})
				.from(absenceEntry)
				.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
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
		}),
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
	evidence?: EmployeeRequirementInputs["shifts"];
}): Promise<DailyWorkRequirements> {
	const requestedZone =
		params.timezone && isValidIanaTimeZone(params.timezone) ? params.timezone : "UTC";
	const firstDay = plainDateAt(instantFromDate(params.startDate), requestedZone);
	const lastDay = plainDateAt(instantFromDate(params.endDate), requestedZone);
	if (comparePlainDates(firstDay, lastDay) > 0) return {};

	const evidence = params.evidence;
	const bounds = evidence
		? shiftDateRangeBounds(firstDay, lastDay.add({ days: 1 }), evidence.organizationTimezone)
		: null;
	const assignedShifts =
		evidence && bounds
			? {
					organizationTimezone: evidence.organizationTimezone,
					shifts: evidence.shifts.filter(
						(row) => row.date >= bounds.start && row.date < bounds.endExclusive,
					),
				}
			: await Effect.runPromise(
					params.database.query("getPublishedShiftsForCalendarRequirements", async () => {
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
					}),
				);

	return buildShiftDailyWorkRequirements({
		shifts: assignedShifts.shifts,
		organizationTimezone: assignedShifts.organizationTimezone,
	});
}

function enumeratePlainDates(start: PlainDate, end: PlainDate): PlainDate[] {
	if (comparePlainDates(start, end) > 0) return [];
	const dates: PlainDate[] = [];
	for (let cursor = start; comparePlainDates(cursor, end) <= 0; cursor = cursor.add({ days: 1 })) {
		dates.push(cursor);
	}
	return dates;
}

async function buildContractDailyRequirements(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
	employeeEmploymentStartDateOverride?: string;
	evidence?: EmployeeRequirementInputs;
}): Promise<DailyWorkRequirements> {
	const timezone =
		params.timezone && isValidIanaTimeZone(params.timezone) ? params.timezone : "UTC";
	const firstDay = plainDateAt(instantFromDate(params.startDate), timezone);
	const lastDay = plainDateAt(instantFromDate(params.endDate), timezone);
	const dates = enumeratePlainDates(firstDay, lastDay);
	if (dates.length === 0) return {};

	const contractsByDate =
		params.evidence?.contracts ??
		(
			await Effect.runPromise(
				params.database.query("calendar.resolveContractsForEmployee", () =>
					loadEffectiveContractsBatch(params.database.db, {
						organizationId: params.organizationId,
						employeeIds: [params.employeeId],
						dates,
						timezoneOverride: timezone,
						employmentStartDateOverride: params.employeeEmploymentStartDateOverride,
					}),
				),
			)
		).get(params.employeeId) ??
		new Map<string, EffectiveContractOnDay>();

	const shiftDays = new Set<string>();
	const trustBasedDates = new Set<string>();
	const requirements: DailyWorkRequirements = {};
	for (const day of dates) {
		const dateKey = day.toString();
		const contract = contractsByDate.get(dateKey);
		if (!contract) continue;

		if (contract.contributesZeroBalanceDelta) {
			trustBasedDates.add(dateKey);
		}
		// An External Contractor day has no required time, not even from published shifts (#1996).
		if (!contract.isEmployedOnDay || contract.engagementKind === "contractor") continue;

		if (contract.contractType === "hourly" || contract.scheduleSource === "published_shifts") {
			shiftDays.add(dateKey);
			continue;
		}

		if (contract.requiredMinutes > 0) {
			requirements[dateKey] = {
				requiredMinutes: contract.requiredMinutes,
				policyId: contract.workPolicy?.policyId ?? "contract",
				policyName: contract.workPolicy?.policyName ?? "Contract",
				balanceMode: contract.balanceMode,
				contributesZeroBalanceDelta: contract.contributesZeroBalanceDelta,
			};
		}
	}

	if (shiftDays.size > 0) {
		const shiftRequirements = await getPublishedShiftRequirementsForEmployee({
			database: params.database,
			organizationId: params.organizationId,
			employeeId: params.employeeId,
			startDate: params.startDate,
			endDate: params.endDate,
			timezone,
			evidence: params.evidence?.shifts,
		});
		for (const dateKey of shiftDays) {
			const shiftReq = shiftRequirements[dateKey];
			if (!shiftReq) continue;
			const contract = contractsByDate.get(dateKey);
			requirements[dateKey] = {
				...shiftReq,
				balanceMode: contract?.balanceMode,
				contributesZeroBalanceDelta: contract?.contributesZeroBalanceDelta,
			};
		}
	}

	return attachTrustBasedBalanceDates(requirements, trustBasedDates);
}

async function getFirstCompletedWorkPeriodBeforeAccount(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	accountCreatedAt: Date;
}): Promise<Date | null> {
	const [row] = await Effect.runPromise(
		params.database.query("getFirstCompletedWorkPeriodBeforeAccount", async () => {
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
		}),
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

/** Internal range evidence; it is never accepted from a browser request. */
export type EmployeeRequirementInputs = {
	scopedEmployee: {
		id: string;
		startDate: Date | null;
		contractType: (typeof employee.$inferSelect)["contractType"];
		user: { createdAt: Date };
		userSettings: { timezone: string | null } | null;
		organization: { timezone: string | null };
	};
	contracts?: ReadonlyMap<string, EffectiveContractOnDay>;
	shifts: { organizationTimezone: string; shifts: ShiftRequirementSource[] };
	absences: ApprovedAbsenceRange[];
	employmentCoverage: EmploymentInterval[] | null;
	holidays: AssignedHolidayRange[];
	/** Credited apprentice release days (#1993); loaded per employee when left out. */
	apprenticeReleaseDays?: ApprenticeReleaseDay[];
};

/**
 * The employee's daily work requirements from `startDate`'s day through `endDate`'s, as an effect
 * on the caller's `DatabaseService`.
 */
export function loadDailyWorkRequirementsForEmployee(
	params: DailyWorkRequirementsParams,
	preloaded?: {
		tracking: EmployeeTrackingContext | null;
		inputs?: EmployeeRequirementInputs;
	},
) {
	return Effect.gen(function* () {
		const database = yield* DatabaseService;
		const scopedEmployee =
			preloaded?.inputs?.scopedEmployee ??
			(yield* database.query("getEmployeeForCalendarRequirements", async () => {
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
			}));
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
		const tracking = preloaded
			? preloaded.tracking
			: yield* database.query("tracking.employeeStart", () =>
					loadEmployeeTrackingContext(database.db, params),
				);
		if (tracking) params = { ...params, timezone: tracking.timezone };
		const requestedStartInstant = instantFromDate(params.startDate);
		const accountCreatedInstant = instantFromDate(scopedEmployee.user.createdAt);
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
		const employeeStartInstant = params.employeeEmploymentStartDateOverride
			? parseUtcDateOrInstant(params.employeeEmploymentStartDateOverride)
			: scopedEmployee.startDate
				? instantFromDate(scopedEmployee.startDate)
				: accountCreatedInstant;
		const normalStartInstant = laterInstant(accountCreatedInstant, employeeStartInstant);
		const lowerBoundInstant = tracking
			? parsePlainDate(tracking.startDate).toZonedDateTime(tracking.timezone).toInstant()
			: firstCompletedWorkPeriodBeforeAccount
				? earlierInstant(instantFromDate(firstCompletedWorkPeriodBeforeAccount), normalStartInstant)
				: normalStartInstant;
		const effectiveStartDate = dateFromInstant(
			laterInstant(requestedStartInstant, lowerBoundInstant),
		);
		if (effectiveStartDate > params.endDate) return {};

		const requirements = yield* Effect.promise(() =>
			buildContractDailyRequirements({
				database,
				organizationId: params.organizationId,
				employeeId: params.employeeId,
				startDate: effectiveStartDate,
				endDate: params.endDate,
				timezone: params.timezone,
				employeeEmploymentStartDateOverride: params.employeeEmploymentStartDateOverride,
				evidence: preloaded?.inputs,
			}),
		);
		const approvedAbsences =
			preloaded?.inputs?.absences ??
			(yield* Effect.promise(() =>
				getApprovedAbsenceRanges({
					database,
					organizationId: params.organizationId,
					employeeId: params.employeeId,
					startDate: effectiveStartDate,
					endDate: params.endDate,
					timezone: params.timezone,
				}),
			));

		// Days outside employment (after a departure, or between stints) require nothing.
		const employmentCoverage = preloaded?.inputs
			? preloaded.inputs.employmentCoverage
			: yield* database.query("getEmploymentCoverageForRequirements", () =>
					loadEmploymentCoverage(database.db, {
						employeeEmploymentStartDateOverride: params.employeeEmploymentStartDateOverride,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
					}),
				);
		const employedRequirements = preserveTrustBasedBalanceDates(
			requirements,
			clipRequirementsToEmployment(requirements, employmentCoverage, params.timezone),
		);

		// Apprentice school and exam release days are paid: they release required time (#1993).
		const requirementZone = resolveRequirementZone(params.timezone);
		const releaseDays =
			preloaded?.inputs?.apprenticeReleaseDays ??
			(yield* database.query("calendar.apprenticeReleaseDays", async () =>
				(
					await loadApprenticeReleaseDays(database.db, {
						organizationId: params.organizationId,
						employeeIds: [params.employeeId],
						from: plainDateAt(instantFromDate(effectiveStartDate), requirementZone).toString(),
						until: plainDateAt(instantFromDate(params.endDate), requirementZone)
							.add({ days: 1 })
							.toString(),
					})
				).get(params.employeeId) ?? [],
			));
		const releaseCreditedRequirements = applyApprenticeReleaseCredits(
			employedRequirements,
			releaseDays,
		);

		// Existing regression contract matches the call sequence.
		// oxfmt-ignore
		const absenceAdjustedRequirements = applyApprovedAbsencesToDailyRequirements(
				releaseCreditedRequirements,
				approvedAbsences,
			);
		const assignedHolidays =
			preloaded?.inputs?.holidays ??
			(yield* Effect.promise(() =>
				getAssignedHolidaysForEmployee({
					organizationId: params.organizationId,
					employeeId: params.employeeId,
					startDate: effectiveStartDate,
					endDate: params.endDate,
					database: database.db,
				}),
			));

		// Source-level regression test asserts this call order.
		// oxfmt-ignore
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
			Effect.provideService(DatabaseService, makeDatabaseService(dbClient as DatabaseClient)),
		),
	);
}
