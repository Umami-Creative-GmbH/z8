import { and, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { employeeEmploymentHistory, employeeStatutoryOffset, shift, workPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
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
}

/** A planned shift (persisted from today on, or proposed by Staffing) on a short-term day. */
export interface ShortTermPlanItem {
	/** Null for Staffing's proposed shift. */
	readonly shiftId: string | null;
	readonly date: string;
	readonly startTime: string;
	readonly endTime: string;
	readonly minutes: number;
	readonly hourlyRateCents: number | null;
	readonly currency: string;
}

export interface ShortTermPriorOffset {
	readonly offsetId: string;
	readonly kind: "prior_short_term_work_days" | "prior_short_term_months";
	readonly year: number;
	readonly count: number;
}

export interface ShortTermEmployeeInputs {
	readonly employeeId: string;
	readonly work: readonly ShortTermWorkItem[];
	readonly planned: readonly ShortTermPlanItem[];
	readonly priorOffsets: readonly ShortTermPriorOffset[];
	/** The allowance applying in each requested year, from the latest short-term terms in it. */
	readonly limitKindByYear: ReadonlyMap<number, ShortTermLimitKind>;
	/** Years in which the employee has short-term terms at all. */
	readonly shortTermYears: ReadonlySet<number>;
}

export interface ShortTermInputs {
	readonly employees: readonly ShortTermEmployeeInputs[];
	readonly thresholds: StatutoryThresholdTable;
}

const MINUTES_PER_DAY = 24 * 60;

function minutesOfDay(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Wall-clock length of a shift; an end at or before the start runs into the next day. */
export function shiftMinutes(startTime: string, endTime: string): number {
	const length = minutesOfDay(endTime) - minutesOfDay(startTime);
	return length > 0 ? length : length + MINUTES_PER_DAY;
}

/**
 * Days of a work week the contract plans as work days. A policy schedule (or weekly hours without
 * a policy, which resolve to Monday–Friday) of five or more days is a continuous ≥ 5-day pattern.
 */
function limitKindOf(contract: EffectiveContractOnDay | undefined): ShortTermLimitKind {
	if (!contract || contract.scheduleSource !== "policy") return "work_days";
	const workDays = contract.weeklyScheduleDays.filter((day) => day.isWorkDay).length;
	return workDays >= 5 ? "months" : "work_days";
}

function yearOf(date: string): number {
	return Number(date.slice(0, 4));
}

function centsOf(rate: number | null): number | null {
	return rate === null ? null : Math.round(rate * 100);
}

/** The latest of `today` clamped into `year`: the day whose terms speak for a year without work. */
function referenceDate(year: number, today: string): string {
	if (yearOf(today) < year) return `${year}-01-01`;
	if (yearOf(today) > year) return `${year}-12-31`;
	return today;
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
		/** Organization-local today: shifts from today on are planned work. */
		readonly today: string;
		readonly scopeDates?: readonly string[];
		readonly proposedShifts: readonly StatutoryProposedShift[];
		readonly replacesShiftId: string | null;
	},
): Promise<ShortTermInputs> {
	const firstYear = Math.min(...input.years);
	const lastYear = Math.max(...input.years);
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
	const plannedByEmployee = new Map<
		string,
		{ shiftId: string | null; date: string; startTime: string; endTime: string }[]
	>();
	const addPlanned = (
		employeeId: string,
		item: { shiftId: string | null; date: string; startTime: string; endTime: string },
	) => {
		if (!inYears(item.date)) return;
		plannedByEmployee.set(employeeId, [...(plannedByEmployee.get(employeeId) ?? []), item]);
	};
	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const date = shiftCalendarDate(row.date, input.timezone).toString();
		// Past shifts are not planned work any more: completed work speaks for those days.
		if (date < input.today) continue;
		addPlanned(row.employeeId, {
			shiftId: row.id,
			date,
			startTime: row.startTime,
			endTime: row.endTime,
		});
	}
	for (const proposed of input.proposedShifts) {
		if (!candidates.includes(proposed.employeeId)) continue;
		parsePlainDate(proposed.date);
		addPlanned(proposed.employeeId, {
			shiftId: null,
			date: proposed.date,
			startTime: proposed.startTime,
			endTime: proposed.endTime,
		});
	}

	const references = input.years.map((year) => referenceDate(year, input.today));
	const dates = new Set<string>(references);
	for (const list of workByEmployee.values()) for (const item of list) dates.add(item.date);
	for (const list of plannedByEmployee.values()) for (const item of list) dates.add(item.date);
	const contracts = await contractsOn(candidates, [...dates]);

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
			});
		}
		const planned: ShortTermPlanItem[] = [];
		for (const item of plannedByEmployee.get(employeeId) ?? []) {
			const contract = shortTermOn(item.date);
			if (!contract) continue;
			planned.push({
				...item,
				minutes: shiftMinutes(item.startTime, item.endTime),
				hourlyRateCents: centsOf(contract.hourlyRate),
				currency: contract.currency,
			});
		}

		const limitKindByYear = new Map<number, ShortTermLimitKind>();
		const shortTermYears = new Set<number>();
		for (const row of termRows) {
			if (row.employeeId !== employeeId) continue;
			for (const year of input.years) {
				const overlaps =
					row.validFromDate < `${year + 1}-01-01` &&
					(row.validUntilDate === null || row.validUntilDate > `${year}-01-01`);
				if (overlaps) shortTermYears.add(year);
			}
		}
		for (const year of input.years) {
			const counted = [...work, ...planned]
				.map((item) => item.date)
				.filter((date) => yearOf(date) === year)
				.sort();
			const latest = counted.at(-1);
			const reference = referenceDate(year, input.today);
			limitKindByYear.set(
				year,
				limitKindOf(latest ? byDate.get(latest) : (shortTermOn(reference) ?? undefined)),
			);
		}

		employees.push({
			employeeId,
			work,
			planned,
			priorOffsets: offsetRows
				.filter((row) => row.employeeId === employeeId && row.countValue !== null)
				.map((row) => ({
					offsetId: row.id,
					kind: row.offsetKind as ShortTermPriorOffset["kind"],
					year: yearOf(row.validFromDate),
					count: row.countValue ?? 0,
				})),
			limitKindByYear,
			shortTermYears,
		});
	}
	return { employees, thresholds };
}
