import { and, eq, gte, isNotNull, lt, lte, min } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { absenceCategory, absenceEntry, employee, workPeriod } from "@/db/schema";
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
}

function hoursToMinutes(hours: string | null | undefined): number {
	const parsed = Number.parseFloat(hours ?? "");
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.round(parsed * 60);
}

function getSimpleWorkDays(
	schedule: NonNullable<EffectiveWorkPolicy["schedule"]>,
): EffectiveWorkPolicyScheduleDayName[] {
	if (schedule.workingDaysPreset === "custom") {
		return schedule.days.filter((day) => day.isWorkDay).map((day) => day.dayOfWeek);
	}

	return PRESET_DAYS[schedule.workingDaysPreset] ?? [];
}

function getRequiredMinutesForDay(
	policy: EffectiveWorkPolicy,
	dayName: EffectiveWorkPolicyScheduleDayName,
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

		const cycleMinutes = hoursToMinutes(schedule.hoursPerCycle);
		return cycleMinutes > 0 ? Math.round(cycleMinutes / workDays.length) : 0;
	}

	return 0;
}

export function buildDailyWorkRequirements({
	policy,
	startDate,
	endDate,
}: BuildDailyWorkRequirementsOptions): DailyWorkRequirements {
	if (!policy?.schedule) return {};

	const start = DateTime.fromJSDate(startDate, { zone: "utc" }).startOf("day");
	const end = DateTime.fromJSDate(endDate, { zone: "utc" }).startOf("day");
	if (!start.isValid || !end.isValid || end < start) return {};

	const requirements: DailyWorkRequirements = {};

	for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
		const dayName = WEEKDAY_BY_NUMBER[cursor.weekday];
		const requiredMinutes = getRequiredMinutesForDay(policy, dayName);
		if (requiredMinutes <= 0) continue;

		requirements[cursor.toFormat("yyyy-MM-dd")] = {
			requiredMinutes,
			policyId: policy.policyId,
			policyName: policy.policyName,
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
}): Promise<ApprovedAbsenceRange[]> {
	const start = DateTime.fromJSDate(params.startDate).toFormat("yyyy-MM-dd");
	const end = DateTime.fromJSDate(params.endDate).toFormat("yyyy-MM-dd");

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
						columns: { id: true, startDate: true },
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
			const policy = yield* _(service.getEffectivePolicy(params.employeeId));
			const requirements = buildDailyWorkRequirements({
				policy,
				startDate: effectiveStartDate,
				endDate: params.endDate,
			});
			const approvedAbsences = yield* _(
				Effect.promise(() =>
					getApprovedAbsenceRanges({
						database,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						startDate: effectiveStartDate,
						endDate: params.endDate,
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
