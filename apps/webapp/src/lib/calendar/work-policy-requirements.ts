import { and, eq, gt, gte, isNotNull, isNull, lt, lte, min, or } from "drizzle-orm";
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
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	type EffectiveWorkPolicy,
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
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
	timezone?: string | null;
}

type EmploymentRequirementSlice = {
	validFrom: Date;
	validUntil: Date | null;
	contractType: "fixed" | "hourly";
	weeklyContractMinutes: number;
	workPolicyId: string | null;
};

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

export function buildDailyWorkRequirements({
	policy,
	startDate,
	endDate,
	timezone,
	weeklyContractMinutes,
}: BuildDailyWorkRequirementsOptions): DailyWorkRequirements {
	if (!policy?.schedule) return {};

	const requestedZone = timezone || "utc";
	const zonedStart = DateTime.fromJSDate(startDate, { zone: "utc" }).setZone(requestedZone);
	const zonedEnd = DateTime.fromJSDate(endDate, { zone: "utc" }).setZone(requestedZone);
	const start = (
		zonedStart.isValid ? zonedStart : DateTime.fromJSDate(startDate, { zone: "utc" })
	).startOf("day");
	const end = (zonedEnd.isValid ? zonedEnd : DateTime.fromJSDate(endDate, { zone: "utc" })).startOf(
		"day",
	);
	if (!start.isValid || !end.isValid || end < start) return {};

	const requirements: DailyWorkRequirements = {};

	for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
		const dayName = WEEKDAY_BY_NUMBER[cursor.weekday];
		const requiredMinutes = getRequiredMinutesForDay(policy, dayName, weeklyContractMinutes);
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
					requiredMinutes: existing.requiredMinutes + requirement.requiredMinutes,
					policyId: requirement.policyId,
					policyName: requirement.policyName,
				}
			: requirement;
	}

	return target;
}

function getSliceDateRange(slice: EmploymentRequirementSlice, startDate: Date, endDate: Date) {
	const start = DateTime.max(
		DateTime.fromJSDate(startDate, { zone: "utc" }),
		DateTime.fromJSDate(slice.validFrom, { zone: "utc" }),
	).toJSDate();
	const sliceEnd = slice.validUntil
		? DateTime.fromJSDate(slice.validUntil, { zone: "utc" }).minus({ milliseconds: 1 })
		: DateTime.fromJSDate(endDate, { zone: "utc" });
	const end = DateTime.min(DateTime.fromJSDate(endDate, { zone: "utc" }), sliceEnd).toJSDate();

	return { start, end };
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
	timezone,
}: BuildShiftDailyWorkRequirementsOptions): DailyWorkRequirements {
	const requestedZone = timezone || "utc";
	const requirements: DailyWorkRequirements = {};

	for (const assignedShift of shifts) {
		const dateKey = DateTime.fromJSDate(assignedShift.date, { zone: "utc" }).toISODate();
		if (!dateKey) continue;

		const start = DateTime.fromISO(`${dateKey}T${assignedShift.startTime}`, {
			zone: requestedZone,
		});
		const parsedEnd = DateTime.fromISO(`${dateKey}T${assignedShift.endTime}`, {
			zone: requestedZone,
		});
		if (!start.isValid || !parsedEnd.isValid) continue;

		const end = parsedEnd <= start ? parsedEnd.plus({ days: 1 }) : parsedEnd;
		const requiredMinutes = Math.round(end.diff(start, "minutes").minutes);
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
	const zonedStart = DateTime.fromJSDate(params.startDate, { zone: "utc" }).setZone(requestedZone);
	const zonedEnd = DateTime.fromJSDate(params.endDate, { zone: "utc" }).setZone(requestedZone);
	const start = (
		zonedStart.isValid ? zonedStart : DateTime.fromJSDate(params.startDate, { zone: "utc" })
	).toFormat("yyyy-MM-dd");
	const end = (
		zonedEnd.isValid ? zonedEnd : DateTime.fromJSDate(params.endDate, { zone: "utc" })
	).toFormat("yyyy-MM-dd");

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
						eq(absenceCategory.requiresWorkTime, false),
						lte(absenceEntry.startDate, end),
						gte(absenceEntry.endDate, start),
					),
				);
		}),
	);
}

async function getPublishedShiftRequirementsForEmployee(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
}): Promise<DailyWorkRequirements> {
	const assignedShifts = await Effect.runPromise(
		params.database.query("getPublishedShiftsForCalendarRequirements", async () => {
			return params.database.db
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
						gte(shift.date, params.startDate),
						lte(shift.date, params.endDate),
					),
				);
		}),
	);

	return buildShiftDailyWorkRequirements({
		shifts: assignedShifts,
		timezone: params.timezone,
	});
}

async function getConfirmedEmploymentRequirementSlices(params: {
	database: typeof DatabaseService.Service;
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
}): Promise<EmploymentRequirementSlice[]> {
	return Effect.runPromise(
		params.database.query("getConfirmedEmploymentRequirementSlices", async () => {
			return params.database.db.query.employeeEmploymentHistory.findMany({
				where: and(
					eq(employeeEmploymentHistory.employeeId, params.employeeId),
					eq(employeeEmploymentHistory.organizationId, params.organizationId),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
					lte(employeeEmploymentHistory.validFrom, params.endDate),
					or(
						isNull(employeeEmploymentHistory.validUntil),
						gt(employeeEmploymentHistory.validUntil, params.startDate),
					),
				),
				columns: {
					validFrom: true,
					validUntil: true,
					contractType: true,
					weeklyContractMinutes: true,
					workPolicyId: true,
				},
				orderBy: (history, { asc }) => [asc(history.validFrom)],
			});
		}),
	);
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
	const slices = await getConfirmedEmploymentRequirementSlices(params);
	if (slices.length === 0) return null;

	const requirements: DailyWorkRequirements = {};

	for (const slice of slices) {
		const { start, end } = getSliceDateRange(slice, params.startDate, params.endDate);
		if (start > end) continue;

		if (slice.contractType === "hourly") {
			mergeDailyWorkRequirements(
				requirements,
				await getPublishedShiftRequirementsForEmployee({
					database: params.database,
					organizationId: params.organizationId,
					employeeId: params.employeeId,
					startDate: start,
					endDate: end,
					timezone: params.timezone,
				}),
			);
			continue;
		}

		const policy = slice.workPolicyId
			? await getEmploymentHistoryWorkPolicy({
					database: params.database,
					organizationId: params.organizationId,
					policyId: slice.workPolicyId,
				})
			: params.fallbackPolicy;

		mergeDailyWorkRequirements(
			requirements,
			buildDailyWorkRequirements({
				policy,
				startDate: start,
				endDate: end,
				timezone: params.timezone,
				weeklyContractMinutes: slice.weeklyContractMinutes,
			}),
		);
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

export async function getDailyWorkRequirementsForEmployee(params: {
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
	timezone?: string | null;
}): Promise<DailyWorkRequirements> {
	return Effect.runPromise(
		Effect.gen(function* (_) {
			const database = yield* _(DatabaseService);
			const scopedEmployee = yield* _(
				database.query("getEmployeeForCalendarRequirements", async () => {
					return database.db.query.employee.findFirst({
						where: and(
							eq(employee.id, params.employeeId),
							eq(employee.organizationId, params.organizationId),
						),
						columns: { id: true, startDate: true, contractType: true },
						with: { user: { columns: { createdAt: true } } },
					});
				}),
			);
			if (!scopedEmployee) return {};

			const requestedStartDate = DateTime.fromJSDate(params.startDate, { zone: "utc" });
			const accountCreatedDate = DateTime.fromJSDate(scopedEmployee.user.createdAt, {
				zone: "utc",
			});
			const firstCompletedWorkPeriodBeforeAccount = yield* _(
				Effect.promise(() =>
					getFirstCompletedWorkPeriodBeforeAccount({
						database,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						accountCreatedAt: scopedEmployee.user.createdAt,
					}),
				),
			);
			const employeeStartDate = scopedEmployee.startDate
				? DateTime.fromJSDate(scopedEmployee.startDate, { zone: "utc" })
				: accountCreatedDate;
			const normalStartDate = DateTime.max(accountCreatedDate, employeeStartDate);
			const lowerBoundDate = firstCompletedWorkPeriodBeforeAccount
				? DateTime.min(
						DateTime.fromJSDate(firstCompletedWorkPeriodBeforeAccount, { zone: "utc" }),
						normalStartDate,
					)
				: normalStartDate;
			const effectiveStartDate = DateTime.max(requestedStartDate, lowerBoundDate).toJSDate();
			if (effectiveStartDate > params.endDate) return {};

			const service = yield* _(WorkPolicyService);
			const fallbackPolicy = yield* _(service.getEffectivePolicy(params.employeeId));
			const historyRequirements = yield* _(
				Effect.promise(() =>
					buildEmploymentHistoryDailyRequirements({
						database,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						startDate: effectiveStartDate,
						endDate: params.endDate,
						timezone: params.timezone,
						fallbackPolicy,
					}),
				),
			);
			const requirements =
				historyRequirements ??
				(scopedEmployee.contractType === "hourly"
					? yield* _(
							Effect.promise(() =>
								getPublishedShiftRequirementsForEmployee({
									database,
									organizationId: params.organizationId,
									employeeId: params.employeeId,
									startDate: effectiveStartDate,
									endDate: params.endDate,
									timezone: params.timezone,
								}),
							),
						)
					: buildDailyWorkRequirements({
							policy: fallbackPolicy,
							startDate: effectiveStartDate,
							endDate: params.endDate,
							timezone: params.timezone,
						}));
			const approvedAbsences = yield* _(
				Effect.promise(() =>
					getApprovedAbsenceRanges({
						database,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						startDate: effectiveStartDate,
						endDate: params.endDate,
						timezone: params.timezone,
					}),
				),
			);

			const absenceAdjustedRequirements = applyApprovedAbsencesToDailyRequirements(
				requirements,
				approvedAbsences,
			);
			const assignedHolidays = yield* _(
				Effect.promise(() =>
					getAssignedHolidaysForEmployee({
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						startDate: effectiveStartDate,
						endDate: params.endDate,
					}),
				),
			);

			// biome-ignore format: source-level regression test asserts this call order.
			return applyAssignedHolidayAdjustmentsToRequirements(absenceAdjustedRequirements, assignedHolidays);
		}).pipe(Effect.provide(WorkPolicyServiceLive), Effect.provide(DatabaseServiceLive)),
	);
}
