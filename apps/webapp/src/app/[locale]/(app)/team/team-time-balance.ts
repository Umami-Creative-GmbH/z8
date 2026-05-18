import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceCategory, absenceEntry, employeeTimeBalance, workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { calculateExpectedWorkHoursForEmployee } from "@/lib/time-tracking/calculations";

type DayPeriod = typeof absenceEntry.$inferSelect.startPeriod;

export type EmployeeTimeBalancePayload = {
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	balanceMinutes: number;
	calculatedAt: Date;
};

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
	const employeeIds = [...new Set(input.employeeIds)];
	const balances = new Map<string, EmployeeTimeBalancePayload>();
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

	for (const employeeId of employeeIds) {
		const expected = await calculateExpectedWorkHoursForEmployee(
			employeeId,
			input.organizationId,
			startDate,
			endDate,
		);
		const absenceAdjustedMinutes = await calculateAbsenceAdjustedMinutes({
			employeeId,
			organizationId: input.organizationId,
			rangeStart: range.start,
			rangeEnd: range.end,
		});
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

	let total = 0;
	for (const absence of absenceRows) {
		let current = DateTime.fromISO(absence.startDate).startOf("day");
		const last = DateTime.fromISO(absence.endDate).startOf("day");
		while (current <= last) {
			if (current >= input.rangeStart.startOf("day") && current <= input.rangeEnd.startOf("day")) {
				const currentDate = current.toJSDate();
				const expected = await calculateExpectedWorkHoursForEmployee(
					input.employeeId,
					input.organizationId,
					currentDate,
					currentDate,
				);
				let period: DayPeriod = "full_day";
				if (current.toISODate() === absence.startDate) period = absence.startPeriod;
				if (current.toISODate() === absence.endDate) period = absence.endPeriod;
				total += calculateDayAbsenceAdjustmentMinutes(expected.totalMinutes, period);
			}
			current = current.plus({ days: 1 });
		}
	}

	return total;
}
