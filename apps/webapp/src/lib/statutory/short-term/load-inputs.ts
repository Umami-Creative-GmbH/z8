import { and, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { employeeEmploymentHistory, employeeStatutoryOffset, shift, workPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { type ShiftInterval, shiftInterval } from "@/lib/scheduling/shift-occasion";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import { loadStatutoryThresholds, type StatutoryThresholdTable } from "../thresholds";

export type ShortTermReader = Pick<DatabaseClient, "select">;

/** Which statutory allowance applies: 70 working days, or 3 months for a ≥ 5-day week. */
export type ShortTermLimitKind = "work_days" | "months";

export const SHORT_TERM_THRESHOLD_KEYS = [
	"de_short_term_max_work_days_per_year",
	"de_short_term_max_months_per_year",
	"de_minijob_monthly_limit_cents",
] as const;

/** Completed work on a short-term day, bucketed on its start day. */
export interface ShortTermWorkItem {
	readonly workPeriodId: string;
	readonly date: string;
	readonly minutes: number;
	/** Confirmed hourly wage on that day in minor units; null for fixed terms or a missing wage. */
	readonly hourlyRateCents: number | null;
	readonly currency: string;
	/** The employment period of that day: a new one starts a new stint. */
	readonly employmentPeriodId: string | null;
}

/** A planned shift (persisted from today on, or proposed by Staffing) on a short-term day. */
export interface ShortTermPlanItem {
	/** Null for Staffing's proposed shift. */
	readonly shiftId: string | null;
	readonly date: string;
	readonly startTime: string;
	readonly endTime: string;
	/** Real length between the start and end instants in the organization's timezone. */
	readonly minutes: number;
	/** Whether the shift had started at the evaluation instant. */
	readonly started: boolean;
	readonly hourlyRateCents: number | null;
	readonly currency: string;
	readonly employmentPeriodId: string | null;
}

export interface ShortTermPriorOffset {
	readonly offsetId: string;
	readonly kind: "prior_short_term_work_days" | "prior_short_term_months";
	readonly year: number;
	readonly count: number;
}

/** The working week behind one calendar year's short-term terms. */
export interface ShortTermYearWeek {
	/** Average work days per week of each short-term terms version that plans real week days. */
	readonly plannedWorkDaysPerWeek: readonly number[];
	/**
	 * Whether some short-term terms of the year plan no real week: a schedule from published
	 * shifts or on-call terms, or weekly hours alone (which the resolver spreads Monday–Friday).
	 */
	readonly unplannedTerms: boolean;
	/** Counted days (`YYYY-MM-DD`, sorted, distinct) under such terms: their week is read from them. */
	readonly unplannedDays: readonly string[];
}

export interface ShortTermEmployeeInputs {
	readonly employeeId: string;
	readonly work: readonly ShortTermWorkItem[];
	readonly planned: readonly ShortTermPlanItem[];
	readonly priorOffsets: readonly ShortTermPriorOffset[];
	/**
	 * Per year with effective short-term terms, the week those terms call for (`judge.ts` chooses
	 * the limit from it). Years without effective short-term terms are absent.
	 */
	readonly weekByYear: ReadonlyMap<number, ShortTermYearWeek>;
}

export interface ShortTermInputs {
	readonly employees: readonly ShortTermEmployeeInputs[];
	readonly thresholds: StatutoryThresholdTable;
}

/** Real length of a shift in `timezone`, so a shift across a DST change is priced correctly. */
export function shiftMinutes(interval: ShiftInterval): number {
	return interval.start.until(interval.end).total("minutes");
}

/**
 * Whether the terms plan real week days: custom days on the terms or an active work-policy
 * schedule. Weekly hours alone are not a week: the resolver spreads them Monday–Friday.
 */
function plansRealWeek(contract: EffectiveContractOnDay): boolean {
	if (contract.scheduleSource !== "policy") return false;
	if (contract.scheduleMode === "custom_days") {
		return contract.weeklyScheduleDays.some((day) => day.isWorkDay);
	}
	return Boolean(contract.workPolicy?.scheduleEnabled && contract.workPolicy.schedule);
}

/**
 * Average work days per week the contract plans, over the whole schedule cycle (a fortnightly
 * rota of 5 and 3 days averages 4). Null when the terms plan no real week days (see
 * `plansRealWeek`): then the week is read from the shifts and work actually counted.
 */
export function averageWorkDaysPerWeek(contract: EffectiveContractOnDay): number | null {
	if (!plansRealWeek(contract)) return null;
	const schedule = contract.workPolicy?.scheduleEnabled ? contract.workPolicy.schedule : null;
	const cycleWeeks = schedule
		? schedule.days.reduce((max, day) => Math.max(max, day.cycleWeek ?? 1), 1)
		: 1;
	// The resolver reads a multi-week cycle only for detailed or custom-day policy schedules, one
	// week at a time; custom days on the terms have no cycle.
	if (
		schedule &&
		cycleWeeks > 1 &&
		contract.scheduleMode !== "custom_days" &&
		(schedule.scheduleType === "detailed" || schedule.workingDaysPreset === "custom")
	) {
		let workDays = 0;
		for (let week = 1; week <= cycleWeeks; week++) {
			const rows = schedule.days.filter((day) => (day.cycleWeek ?? 1) === week);
			const effective =
				rows.length > 0 ? rows : schedule.days.filter((day) => (day.cycleWeek ?? 1) === 1);
			workDays += effective.filter((day) => day.isWorkDay).length;
		}
		return workDays / cycleWeeks;
	}
	const workDays = contract.weeklyScheduleDays.filter((day) => day.isWorkDay).length;
	return workDays > 0 ? workDays : null;
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const key = keyOf(row);
		const list = groups.get(key);
		if (list) list.push(row);
		else groups.set(key, [row]);
	}
	return groups;
}

function yearOf(date: string): number {
	return Number(date.slice(0, 4));
}

function centsOf(rate: number | null): number | null {
	return rate === null ? null : Math.round(rate * 100);
}

/**
 * The first day of each raw short-term terms row within each year. Supersession only ever cuts a
 * row's end (a later confirmed row takes over from its own start), so a row is effective in a
 * year exactly when the resolver returns short-term terms on this day.
 */
function termSampleDates(
	rows: readonly { validFromDate: string; validUntilDate: string | null }[],
	years: readonly number[],
): Map<number, string[]> {
	const samples = new Map<number, string[]>();
	for (const year of years) {
		const yearStart = `${year}-01-01`;
		const nextYear = `${year + 1}-01-01`;
		for (const row of rows) {
			const start = row.validFromDate > yearStart ? row.validFromDate : yearStart;
			const end =
				row.validUntilDate !== null && row.validUntilDate < nextYear
					? row.validUntilDate
					: nextYear;
			if (start >= end) continue;
			const list = samples.get(year);
			if (list) list.push(start);
			else samples.set(year, [start]);
		}
	}
	return samples;
}

/**
 * Loads everything the short-term monitor judges, batched for all employees: confirmed terms
 * (via the contract resolver), completed work, planned shifts, prior-employer offsets and the
 * statutory baselines of the requested calendar years.
 */
export async function loadShortTermInputs(
	db: ShortTermReader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly employeeIds: readonly string[];
		readonly years: readonly number[];
		/** Shifts from this instant's organization-local day on are planned work. */
		readonly now: Instant;
		readonly scopeDates?: readonly string[];
		readonly proposedShifts: readonly StatutoryProposedShift[];
		readonly replacesShiftId: string | null;
	},
): Promise<ShortTermInputs> {
	const firstYear = Math.min(...input.years);
	const lastYear = Math.max(...input.years);
	const today = plainDateAt(input.now, input.timezone).toString();
	const from = `${firstYear}-01-01`;
	const until = `${lastYear + 1}-01-01`;
	const thresholds = await loadStatutoryThresholds(db, {
		keys: SHORT_TERM_THRESHOLD_KEYS,
		from,
		until,
	});

	// Cheap pre-filter: only employees with confirmed short-term terms in the years matter.
	const termRows = await db
		.select({
			employeeId: employeeEmploymentHistory.employeeId,
			validFromDate: employeeEmploymentHistory.validFromDate,
			validUntilDate: employeeEmploymentHistory.validUntilDate,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				inArray(employeeEmploymentHistory.employeeId, [...new Set(input.employeeIds)]),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				eq(employeeEmploymentHistory.employmentProfile, "short_term"),
				lt(employeeEmploymentHistory.validFromDate, until),
				or(
					isNull(employeeEmploymentHistory.validUntilDate),
					gt(employeeEmploymentHistory.validUntilDate, from),
				),
			),
		);
	let candidates = [...new Set(termRows.map((row) => row.employeeId))];
	if (candidates.length === 0) return { employees: [], thresholds };

	const contractsOn = async (employeeIds: readonly string[], dates: readonly string[]) =>
		loadEffectiveContractsBatch(db, {
			organizationId: input.organizationId,
			employeeIds,
			dates,
			organizationTimezone: input.timezone,
			timezoneOverride: input.timezone,
		});

	if (input.scopeDates && input.scopeDates.length > 0) {
		const scoped = await contractsOn(candidates, input.scopeDates);
		candidates = candidates.filter((employeeId) =>
			[...(scoped.get(employeeId)?.values() ?? [])].some(
				(contract) => contract.employmentProfile === "short_term",
			),
		);
		if (candidates.length === 0) return { employees: [], thresholds };
	}

	const yearStart = dateFromInstant(localDayRange(from, input.timezone).start);
	const yearEnd = dateFromInstant(localDayRange(until, input.timezone).start);
	const workRows = await db
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, candidates),
				completedWorkPeriodCondition(),
				gte(workPeriod.startTime, yearStart),
				lt(workPeriod.startTime, yearEnd),
			),
		);

	const shiftBounds = shiftDateRangeBounds(from, until, input.timezone);
	const shiftConditions = [
		eq(shift.organizationId, input.organizationId),
		inArray(shift.employeeId, candidates),
		gte(shift.date, shiftBounds.start),
		lt(shift.date, shiftBounds.endExclusive),
	];
	if (input.replacesShiftId) shiftConditions.push(ne(shift.id, input.replacesShiftId));
	const shiftRows = await db
		.select({
			id: shift.id,
			employeeId: shift.employeeId,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
		})
		.from(shift)
		.where(and(...shiftConditions));

	const offsetRows = await db
		.select({
			id: employeeStatutoryOffset.id,
			employeeId: employeeStatutoryOffset.employeeId,
			offsetKind: employeeStatutoryOffset.offsetKind,
			validFromDate: employeeStatutoryOffset.validFromDate,
			countValue: employeeStatutoryOffset.countValue,
		})
		.from(employeeStatutoryOffset)
		.where(
			and(
				eq(employeeStatutoryOffset.organizationId, input.organizationId),
				inArray(employeeStatutoryOffset.employeeId, candidates),
				inArray(employeeStatutoryOffset.offsetKind, [
					"prior_short_term_work_days",
					"prior_short_term_months",
				]),
				isNull(employeeStatutoryOffset.voidedAt),
				gte(employeeStatutoryOffset.validFromDate, from),
				lt(employeeStatutoryOffset.validFromDate, until),
			),
		);

	const inYears = (date: string) => yearOf(date) >= firstYear && yearOf(date) <= lastYear;
	const workByEmployee = new Map<string, { id: string; date: string; minutes: number }[]>();
	for (const row of workRows) {
		const start = instantFromDate(row.startTime);
		const minutes =
			row.durationMinutes ??
			(row.endTime ? Math.round((row.endTime.getTime() - row.startTime.getTime()) / 60_000) : 0);
		const list = workByEmployee.get(row.employeeId) ?? [];
		list.push({ id: row.id, date: plainDateAt(start, input.timezone).toString(), minutes });
		workByEmployee.set(row.employeeId, list);
	}
	type PlannedShift = Pick<
		ShortTermPlanItem,
		"shiftId" | "date" | "startTime" | "endTime" | "minutes" | "started"
	>;
	const plannedByEmployee = new Map<string, PlannedShift[]>();
	const addPlanned = (
		employeeId: string,
		item: Pick<ShortTermPlanItem, "shiftId" | "date" | "startTime" | "endTime">,
	) => {
		if (!inYears(item.date)) return;
		const interval = shiftInterval(
			{ date: parsePlainDate(item.date), startTime: item.startTime, endTime: item.endTime },
			input.timezone,
		);
		const planned = {
			...item,
			minutes: shiftMinutes(interval),
			started: compareInstants(interval.start, input.now) <= 0,
		};
		const list = plannedByEmployee.get(employeeId);
		if (list) list.push(planned);
		else plannedByEmployee.set(employeeId, [planned]);
	};
	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const date = shiftCalendarDate(row.date, input.timezone).toString();
		// Past shifts are not planned work any more: completed work speaks for those days.
		if (date < today) continue;
		addPlanned(row.employeeId, {
			shiftId: row.id,
			date,
			startTime: row.startTime,
			endTime: row.endTime,
		});
	}
	for (const proposed of input.proposedShifts) {
		if (!candidates.includes(proposed.employeeId)) continue;
		addPlanned(proposed.employeeId, {
			shiftId: null,
			date: proposed.date,
			startTime: proposed.startTime,
			endTime: proposed.endTime,
		});
	}

	const termRowsByEmployee = groupBy(termRows, (row) => row.employeeId);
	const samplesByEmployee = new Map(
		candidates.map((employeeId) => [
			employeeId,
			termSampleDates(termRowsByEmployee.get(employeeId) ?? [], input.years),
		]),
	);
	// Each employee is resolved on its own term starts and counted days only.
	const datesByEmployee = new Map<string, string[]>();
	const allDates = new Set<string>();
	for (const employeeId of candidates) {
		const own = new Set<string>();
		for (const list of samplesByEmployee.get(employeeId)?.values() ?? []) {
			for (const date of list) own.add(date);
		}
		for (const item of workByEmployee.get(employeeId) ?? []) own.add(item.date);
		for (const item of plannedByEmployee.get(employeeId) ?? []) own.add(item.date);
		datesByEmployee.set(employeeId, [...own]);
		for (const date of own) allDates.add(date);
	}
	const contracts =
		allDates.size === 0
			? new Map<string, Map<string, EffectiveContractOnDay>>()
			: await loadEffectiveContractsBatch(db, {
					organizationId: input.organizationId,
					employeeIds: candidates,
					dates: [...allDates],
					datesByEmployee,
					organizationTimezone: input.timezone,
					timezoneOverride: input.timezone,
				});
	const offsetsByEmployee = groupBy(offsetRows, (row) => row.employeeId);

	const employees: ShortTermEmployeeInputs[] = [];
	for (const employeeId of candidates) {
		const byDate = contracts.get(employeeId) ?? new Map<string, EffectiveContractOnDay>();
		const shortTermOn = (date: string) => {
			const contract = byDate.get(date);
			return contract?.employmentProfile === "short_term" ? contract : null;
		};
		const work: ShortTermWorkItem[] = [];
		for (const item of workByEmployee.get(employeeId) ?? []) {
			const contract = shortTermOn(item.date);
			if (!contract) continue;
			work.push({
				workPeriodId: item.id,
				date: item.date,
				minutes: item.minutes,
				hourlyRateCents: centsOf(contract.hourlyRate),
				currency: contract.currency,
				employmentPeriodId: contract.employmentPeriodId,
			});
		}
		const planned: ShortTermPlanItem[] = [];
		for (const item of plannedByEmployee.get(employeeId) ?? []) {
			const contract = shortTermOn(item.date);
			if (!contract) continue;
			planned.push({
				...item,
				hourlyRateCents: centsOf(contract.hourlyRate),
				currency: contract.currency,
				employmentPeriodId: contract.employmentPeriodId,
			});
		}

		// A year is judged when the resolver returns short-term terms on any of its days we look
		// at, and its limit follows all of those terms, not the cycle week of one day.
		const weekByYear = new Map<number, ShortTermYearWeek>();
		const samples = samplesByEmployee.get(employeeId) ?? new Map<number, string[]>();
		const countedDays = new Set([...work, ...planned].map((item) => item.date));
		for (const year of input.years) {
			const counted = [...countedDays].filter((date) => yearOf(date) === year);
			const plannedWorkDaysPerWeek: number[] = [];
			const unplannedDays = new Set<string>();
			let unplannedTerms = false;
			let anyTerms = false;
			for (const date of [...(samples.get(year) ?? []), ...counted]) {
				const contract = shortTermOn(date);
				if (!contract) continue;
				anyTerms = true;
				const perWeek = averageWorkDaysPerWeek(contract);
				if (perWeek !== null) {
					plannedWorkDaysPerWeek.push(perWeek);
					continue;
				}
				unplannedTerms = true;
				if (countedDays.has(date)) unplannedDays.add(date);
			}
			if (!anyTerms) continue;
			weekByYear.set(year, {
				plannedWorkDaysPerWeek,
				unplannedTerms,
				unplannedDays: [...unplannedDays].sort(),
			});
		}

		employees.push({
			employeeId,
			work,
			planned,
			priorOffsets: (offsetsByEmployee.get(employeeId) ?? [])
				.filter((row) => row.countValue !== null)
				.map((row) => ({
					offsetId: row.id,
					kind: row.offsetKind as ShortTermPriorOffset["kind"],
					year: yearOf(row.validFromDate),
					count: row.countValue ?? 0,
				})),
			weekByYear,
		});
	}
	return { employees, thresholds };
}
