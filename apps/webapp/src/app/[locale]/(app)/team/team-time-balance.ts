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
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { calculateExpectedWorkHoursForEmployee } from "@/lib/time-tracking/calculations";
import type { EmployeeTimeBalancePayload } from "./team-time-balance-types";

export type { EmployeeTimeBalancePayload } from "./team-time-balance-types";

type DayPeriod = typeof absenceEntry.$inferSelect.startPeriod;

export function getCurrentYearRange(now: DateTime = DateTime.utc()) {
	const current = now.toUTC();
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
	calculatedAt: Date;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		year: input.year,
		actualMinutes: input.actualMinutes,
		expectedMinutes: input.expectedMinutes,
		absenceAdjustedMinutes: input.absenceAdjustedMinutes,
		balanceMinutes: calculateBalanceMinutes(input),
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

	const range = getCurrentYearRange(input.now);
	const startDate = dateToDB(range.start)!;
	const endDate = dateToDB(range.end)!;
	const calculatedAt = new Date();

	const actualRows = await db
		.select({
			employeeId: workPeriod.employeeId,
			totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, employeeIds),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, startDate),
				lte(workPeriod.startTime, endDate),
			),
		)
		.groupBy(workPeriod.employeeId);

	const actualByEmployee = new Map(
		actualRows.map((row) => [row.employeeId, Number(row.totalMinutes ?? 0)]),
	);

	const balanceRows = await Promise.all(
		employeeIds.map(async (employeeId) => {
			const [expected, absenceAdjustedMinutes] = await Promise.all([
				calculateExpectedWorkHoursForEmployee(employeeId, input.organizationId, startDate, endDate),
				calculateAbsenceAdjustedMinutes({
					employeeId,
					organizationId: input.organizationId,
					rangeStart: range.start,
					rangeEnd: range.end,
				}),
			]);
			const values = buildEmployeeTimeBalanceValues({
				employeeId,
				organizationId: input.organizationId,
				year: range.year,
				actualMinutes: actualByEmployee.get(employeeId) ?? 0,
				expectedMinutes: expected.totalMinutes,
				absenceAdjustedMinutes,
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
				eq(absenceCategory.requiresWorkTime, false),
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
				const expected = await calculateExpectedWorkHoursForEmployee(
					input.employeeId,
					input.organizationId,
					date,
					date,
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
