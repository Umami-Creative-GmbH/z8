import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import {
	buildPayrollAbsenceDetails,
	payrollAbsenceDetailDays,
} from "@/lib/payroll-workspace/absence-details";
import { daySettlement } from "./settlement-values";
import type {
	CreditedWorkSpan,
	PayrollPeriodAbsence,
	PayrollPeriodAbsenceSource,
	PayrollPeriodDay,
	PayrollPeriodDayAbsence,
	PayrollPeriodEmployee,
	PayrollPeriodEmployeeSource,
	PayrollPeriodHolidaySource,
	PayrollPeriodRows,
	PayrollSettledDaySource,
} from "./types";

const TWO = BigInt(2);

/**
 * The pure part of the payroll period module: one entry per employee-local day.
 *
 * Work arrives already credited to the period by the payroll credit rule (#260 §5):
 * each span is the credited part of a record and carries its credited minutes. A span
 * is split at the employee's local midnights by cumulative proportional allocation
 *
 *   C(t) = roundHalfUp(M * (t - s) / (e - s)),  day credit = C(dayEnd) - C(dayStart)
 *
 * which telescopes, so an employee's days always add up exactly to the period credit.
 * A span whose stored minutes differ from its elapsed time (an unlocated break) has no
 * known break position; it is spread over its days in the same proportion.
 */
export function buildPayrollPeriodRows(input: {
	period: { startDate: string; endDate: string };
	employees: readonly PayrollPeriodEmployeeSource[];
	work: readonly CreditedWorkSpan[];
	absences: readonly PayrollPeriodAbsenceSource[];
	/** Daily work requirements by employee, keyed by employee-local date. */
	requirements?: ReadonlyMap<string, Readonly<Record<string, { requiredMinutes: number }>>>;
	holidays?: ReadonlyMap<string, readonly PayrollPeriodHolidaySource[]>;
	/** Active settlements of the employees' days (#1896). */
	settledDays?: readonly PayrollSettledDaySource[];
}): PayrollPeriodRows {
	const dates = periodDates(input.period.startDate, input.period.endDate);
	const workByEmployee = Map.groupBy(input.work, (row) => row.employeeId);
	const absences = layOutAbsences(input.absences, input.period);
	const absenceMarksByEmployee = Map.groupBy(
		absences.flatMap((row) => row.marks),
		(mark) => mark.employeeId,
	);
	const settledByEmployeeDay = new Map(
		(input.settledDays ?? []).map((row) => [`${row.employeeId}:${row.date}`, row]),
	);

	const employees = input.employees.map((source): PayrollPeriodEmployee => {
		const marksByDate = Map.groupBy(
			absenceMarksByEmployee.get(source.id) ?? [],
			(mark) => mark.date,
		);
		// Spans arrive clipped to the employee-local period window, so every minute lands on
		// a period day. A span clipped in another zone (an export's stored work after the
		// employee changed zones) can reach past it: those minutes belong to days outside
		// the period and are never moved onto its first or last day.
		const credited = new Map<string, number>();
		for (const row of workByEmployee.get(source.id) ?? []) {
			for (const [date, minutes] of splitCreditByLocalDay(row, source.timezone)) {
				credited.set(date, (credited.get(date) ?? 0) + minutes);
			}
		}
		const requirements = input.requirements?.get(source.id);
		const holidayByDate = holidayNamesByDate(input.holidays?.get(source.id) ?? []);
		const days = dates.map((date): PayrollPeriodDay => {
			const creditedMinutes = credited.get(date) ?? 0;
			// A requirement source lists only days that require time; other days require none.
			const requiredMinutes = requirements ? (requirements[date]?.requiredMinutes ?? 0) : null;
			const holiday = holidayByDate.get(date);
			const day: PayrollPeriodDay = {
				date,
				creditedMinutes,
				requiredMinutes,
				differenceMinutes: requiredMinutes === null ? null : creditedMinutes - requiredMinutes,
				absences: (marksByDate.get(date) ?? []).map(
					({ employeeId: _employeeId, date: _date, ...mark }) => mark,
				),
				holiday: holiday ? { name: holiday } : null,
			};
			// The comparison with the copy taken at settling (#1897).
			day.settlement = daySettlement(settledByEmployeeDay.get(`${source.id}:${date}`), day);
			return day;
		});
		const creditedMinutes = days.reduce((sum, day) => sum + day.creditedMinutes, 0);
		const requiredDays = days.filter((day) => day.requiredMinutes !== null);
		const requiredMinutes =
			requiredDays.length === 0
				? null
				: requiredDays.reduce((sum, day) => sum + (day.requiredMinutes ?? 0), 0);
		return {
			...source,
			days,
			totals: {
				creditedMinutes,
				requiredMinutes,
				differenceMinutes: requiredMinutes === null ? null : creditedMinutes - requiredMinutes,
				absenceDays: days.reduce(
					(sum, day) =>
						sum +
						day.absences
							.filter((mark) => mark.approvalState === "approved")
							.reduce((daySum, mark) => daySum + payrollAbsenceDetailDays(mark.period), 0),
					0,
				),
			},
		};
	});

	return {
		employees,
		absences: absences.map(({ marks: _marks, ...row }) => row),
	};
}

type AbsenceMark = PayrollPeriodDayAbsence & { employeeId: string; date: string };

/** Each absence's marks on its logical (employee-local) days inside the period. */
function layOutAbsences(
	sources: readonly PayrollPeriodAbsenceSource[],
	period: { startDate: string; endDate: string },
): (PayrollPeriodAbsence & { marks: AbsenceMark[] })[] {
	return sources
		.map((source) => {
			const marks = buildPayrollAbsenceDetails([source], {
				start: period.startDate,
				end: period.endDate,
			}).map((detail): AbsenceMark => ({
				employeeId: source.employeeId,
				date: detail.date,
				absenceId: source.id,
				categoryId: source.categoryId,
				categoryName: source.categoryName,
				categoryType: source.categoryType,
				categoryColor: source.categoryColor,
				period: detail.period,
				approvalState: source.approvalState,
			}));
			return {
				...source,
				daysInPeriod: marks.reduce((sum, mark) => sum + payrollAbsenceDetailDays(mark.period), 0),
				marks,
			};
		})
		.filter((row) => row.marks.length > 0)
		.toSorted(
			(left, right) =>
				compare(left.employeeId, right.employeeId) ||
				compare(left.startDate, right.startDate) ||
				compare(left.categoryName, right.categoryName) ||
				compare(left.id, right.id),
		);
}

function holidayNamesByDate(holidays: readonly PayrollPeriodHolidaySource[]): Map<string, string> {
	const names = new Map<string, string[]>();
	for (const holiday of holidays) {
		for (const date of periodDates(holiday.startDate, holiday.endDate)) {
			names.set(date, [...(names.get(date) ?? []), holiday.name]);
		}
	}
	return new Map([...names].map(([date, list]) => [date, [...new Set(list)].join(", ")]));
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** Credited minutes of one span per employee-local date, summing exactly to `span.minutes`. */
export function splitCreditByLocalDay(
	span: Pick<CreditedWorkSpan, "startAt" | "endExclusive" | "minutes">,
	timezone: string,
): Map<string, number> {
	const result = new Map<string, number>();
	const start = span.startAt.epochNanoseconds;
	const end = span.endExclusive.epochNanoseconds;
	let date = plainDateAt(span.startAt, timezone).toString();
	if (end <= start) {
		result.set(date, span.minutes);
		return result;
	}

	const elapsed = end - start;
	const stored = BigInt(span.minutes);
	const cumulative = (boundary: bigint) => {
		const progressed = boundary <= start ? BigInt(0) : boundary >= end ? elapsed : boundary - start;
		return (TWO * stored * progressed + elapsed) / (TWO * elapsed);
	};

	let dayStart = start;
	while (dayStart < end) {
		const dayEnd = localDayRange(date, timezone).endExclusive.epochNanoseconds;
		const minutes = Number(cumulative(dayEnd) - cumulative(dayStart));
		if (minutes !== 0) result.set(date, (result.get(date) ?? 0) + minutes);
		dayStart = dayEnd;
		date = parsePlainDate(date).add({ days: 1 }).toString();
	}
	return result;
}

function periodDates(startDate: string, endDate: string): string[] {
	const dates: string[] = [];
	for (
		let date = parsePlainDate(startDate);
		date.toString() <= endDate;
		date = date.add({ days: 1 })
	) {
		dates.push(date.toString());
	}
	return dates;
}
