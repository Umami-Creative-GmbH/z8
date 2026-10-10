import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeTimeBalance,
	workPeriod,
} from "@/db/schema";
import { absenceCategoryReleasesRequiredTime } from "@/lib/absences/required-time-release";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { runtime } from "@/lib/effect/runtime";
import { instantFromDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { calculateExpectedWorkHoursForEmployee } from "@/lib/time-tracking/calculations";
import { readWorkBalanceAdjustments } from "@/lib/work-balance/adjustments/ledger";
import { loadWorkBalanceEmployee } from "@/lib/work-balance/service";
import type { EmployeeTimeBalancePayload } from "./team-time-balance-types";

export type { EmployeeTimeBalancePayload } from "./team-time-balance-types";

type DayPeriod = typeof absenceEntry.$inferSelect.startPeriod;

/** The calendar year of `now` in `timezone` (UTC by default). */
export function getCurrentYearRange(now: DateTime = DateTime.utc(), timezone = "utc") {
	const current = now.setZone(timezone);
	const start = current.startOf("year");
	const end = current.endOf("year");
	return { year: current.year, start, end };
}

export function calculateBalanceMinutes(input: {
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
}) {
	const adjustedExpectedMinutes = Math.max(0, input.expectedMinutes - input.absenceAdjustedMinutes);
	return input.actualMinutes - adjustedExpectedMinutes;
}

export function calculateDayAbsenceAdjustmentMinutes(
	expectedDayMinutes: number,
	period: DayPeriod,
) {
	if (period === "am" || period === "pm") return Math.round(expectedDayMinutes / 2);
	return expectedDayMinutes;
}

export function getAbsenceDayFraction(input: {
	date: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
}) {
	if (input.startDate === input.endDate) {
		if (input.startPeriod === "full_day" || input.endPeriod === "full_day") return 1;
		return input.startPeriod === input.endPeriod ? 0.5 : 1;
	}

	if (input.date === input.startDate) return input.startPeriod === "pm" ? 0.5 : 1;
	if (input.date === input.endDate) return input.endPeriod === "am" ? 0.5 : 1;
	return 1;
}

export function formatSignedBalance(balanceMinutes: number) {
	if (balanceMinutes === 0) return "0h";
	const sign = balanceMinutes > 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(balanceMinutes);
	const hours = Math.floor(absoluteMinutes / 60);
	const minutes = absoluteMinutes % 60;
	return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${minutes}m`;
}

export function buildEmployeeTimeBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	/** Uncancelled balance adjustments dated in the year (#993). */
	balanceAdjustmentMinutes?: number;
	calculatedAt: Date;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		year: input.year,
		actualMinutes: input.actualMinutes,
		expectedMinutes: input.expectedMinutes,
		absenceAdjustedMinutes: input.absenceAdjustedMinutes,
		balanceMinutes: calculateBalanceMinutes(input) + (input.balanceAdjustmentMinutes ?? 0),
		calculatedAt: input.calculatedAt,
	};
}

export async function refreshEmployeeTimeBalances(input: {
	employeeIds: string[];
	organizationId: string;
	now?: DateTime;
}): Promise<Map<string, EmployeeTimeBalancePayload>> {
	const requestedEmployeeIds = [...new Set(input.employeeIds)];
	const balances = new Map<string, EmployeeTimeBalancePayload>();
	if (requestedEmployeeIds.length === 0) return balances;

	const employeeRows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, requestedEmployeeIds),
			),
		);
	const employeeIds = employeeRows.map((row) => row.id);
	if (employeeIds.length === 0) return balances;

	const now = input.now ?? DateTime.utc();
	const calculatedAt = new Date();

	const balanceRows = await Promise.all(
		employeeIds.map(async (employeeId) => {
			const scope = { organizationId: input.organizationId, employeeId };
			// The year and its days are the employee's, in their effective timezone.
			const timezone = (await loadWorkBalanceEmployee(scope, db))?.timezone ?? "UTC";
			const range = getCurrentYearRange(now, timezone);
			const endDate = dateToDB(range.end)!;
			const yesterday = plainDateAt(instantFromDate(now.toJSDate()), timezone).subtract({
				days: 1,
			});
			// Balance adjustments as every other balance view counts them (ADR-0008):
			// each from the end of its day, so through yesterday; an opening balance
			// dated in the year replaces the year through its day.
			const adjustments = await readWorkBalanceAdjustments(db, {
				...scope,
				fromDate: range.start.toISODate()!,
				throughDate: yesterday.toString(),
				openingBalanceDatedLater: "count",
			});
			const countFrom = adjustments.countFrom
				? DateTime.fromISO(adjustments.countFrom, { zone: timezone }).startOf("day")
				: range.start;
			const countsAnyDay = countFrom <= range.end;
			const countFromDate = dateToDB(countFrom)!;
			const [actualMinutes, expectedMinutes, absenceAdjustedMinutes] = countsAnyDay
				? await Promise.all([
						sumCompletedWorkMinutes({ ...scope, startDate: countFromDate, endDate }),
						runtime
							.runPromise(
								calculateExpectedWorkHoursForEmployee(
									employeeId,
									input.organizationId,
									countFromDate,
									endDate,
									timezone,
								),
							)
							.then((expected) => expected.totalMinutes),
						calculateAbsenceAdjustedMinutes({
							...scope,
							rangeStart: countFrom,
							rangeEnd: range.end,
						}),
					])
				: [0, 0, 0];
			const values = buildEmployeeTimeBalanceValues({
				employeeId,
				organizationId: input.organizationId,
				year: range.year,
				actualMinutes,
				expectedMinutes,
				absenceAdjustedMinutes,
				// Overtime payouts lower this balance too; worked minutes stay as worked.
				balanceAdjustmentMinutes: adjustments.adjustmentMinutes,
				calculatedAt,
			});

			await db
				.insert(employeeTimeBalance)
				.values(values)
				.onConflictDoUpdate({
					target: [
						employeeTimeBalance.organizationId,
						employeeTimeBalance.employeeId,
						employeeTimeBalance.year,
					],
					set: {
						actualMinutes: values.actualMinutes,
						expectedMinutes: values.expectedMinutes,
						absenceAdjustedMinutes: values.absenceAdjustedMinutes,
						balanceMinutes: values.balanceMinutes,
						calculatedAt: values.calculatedAt,
						updatedAt: values.calculatedAt,
					},
				});

			return [employeeId, values] as const;
		}),
	);

	for (const [employeeId, values] of balanceRows) {
		balances.set(employeeId, values);
	}

	return balances;
}

async function sumCompletedWorkMinutes(input: {
	employeeId: string;
	organizationId: string;
	startDate: Date;
	endDate: Date;
}) {
	const [row] = await db
		.select({ totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)` })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, input.startDate),
				lte(workPeriod.startTime, input.endDate),
			),
		);
	return Number(row?.totalMinutes ?? 0);
}

async function calculateAbsenceAdjustedMinutes(input: {
	employeeId: string;
	organizationId: string;
	rangeStart: DateTime;
	rangeEnd: DateTime;
}) {
	const absenceRows = await db
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
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.organizationId, input.organizationId),
				absenceCategoryReleasesRequiredTime(),
				lte(absenceEntry.startDate, input.rangeEnd.toISODate()!),
				gte(absenceEntry.endDate, input.rangeStart.toISODate()!),
			),
		);

	const adjustments = await Promise.all(absenceRows.map(async (absence) => {
		const absenceDates: Array<{ isoDate: string; date: Date }> = [];
		let current = DateTime.fromISO(absence.startDate, { zone: "utc" }).startOf("day");
		const last = DateTime.fromISO(absence.endDate, { zone: "utc" }).startOf("day");
		while (current <= last) {
			if (current >= input.rangeStart.startOf("day") && current <= input.rangeEnd.startOf("day")) {
				absenceDates.push({ isoDate: current.toISODate()!, date: current.toJSDate() });
			}
			current = current.plus({ days: 1 });
		}

		const dayAdjustments = await Promise.all(
			absenceDates.map(async ({ isoDate, date }) => {
				const expected = await runtime.runPromise(
					calculateExpectedWorkHoursForEmployee(
						input.employeeId,
						input.organizationId,
						date,
						date,
						"utc",
					),
				);
				const fraction = getAbsenceDayFraction({
					date: isoDate,
					startDate: absence.startDate,
					startPeriod: absence.startPeriod,
					endDate: absence.endDate,
					endPeriod: absence.endPeriod,
				});
				return Math.round(expected.totalMinutes * fraction);
			}),
		);

		return dayAdjustments.reduce((sum, minutes) => sum + minutes, 0);
	}));

	return adjustments.reduce((sum, minutes) => sum + minutes, 0);
}
