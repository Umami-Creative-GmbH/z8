import { and, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { employeeEmploymentHistory, employeeStatutoryOffset, shift, workPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { ContractFieldSource, EffectiveContractOnDay } from "@/lib/contracts/types";
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
import {
	SHIFT_WORK_ASSOCIATION_LEAD_MINUTES,
	type ShiftInterval,
	shiftInterval,
} from "@/lib/scheduling/shift-occasion";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import { loadStatutoryThresholds, type StatutoryThresholdTable } from "../thresholds";
import { matchWorkToShifts, splitWorkAtShiftStarts } from "./work-shift-matching";

export type ShortTermReader = Pick<DatabaseClient, "select">;

/** Which statutory allowance applies: 70 working days, or 3 months for a ≥ 5-day week. */
export type ShortTermLimitKind = "work_days" | "months";

export const SHORT_TERM_THRESHOLD_KEYS = [
	"de_short_term_max_work_days_per_year",
	"de_short_term_max_months_per_year",
	"de_minijob_monthly_limit_cents",
] as const;

/**
 * Completed work or an open clock-in on a short-term day: the date of the shift it belongs to
 * (one clock-in over shifts on two days is split at the later shift's start), else its clock-in's
 * local day.
 */
export interface ShortTermWorkItem {
	readonly workPeriodId: string;
	readonly date: string;
	/**
	 * Whole minutes from the clock-in's minute to the clock-out's minute, or to the evaluation
	 * instant's minute while the clock-in is open: one grid, so clocking out never moves them.
	 */
	readonly minutes: number;
	/**
	 * For an open clock-in: the running shift it belongs to (whose rest is planned work), or
	 * `unplanned` when it belongs to none. Null for completed work.
	 */
	readonly inProgress: { readonly shiftId: string } | "unplanned" | null;
	/** Confirmed hourly wage on that day in minor units; null for fixed terms or a missing wage. */
	readonly hourlyRateCents: number | null;
	readonly currency: string;
	/** The employment period of that day: a new one starts a new stint. */
	readonly employmentPeriodId: string | null;
}

/**
 * Planned work on a short-term day: a persisted shift that has not ended (a running one for what
 * its recorded work has not covered yet), or Staffing's proposed shift.
 */
export interface ShortTermPlanItem {
	/** Null for Staffing's proposed shift. */
	readonly shiftId: string | null;
	readonly date: string;
	readonly startTime: string;
	readonly endTime: string;
	/**
	 * Real length between the start and end instants in the organization's timezone. For a running
	 * shift with recorded work, only its rest: from the evaluation instant's minute while a
	 * clock-in is open, else from the minute its recorded work ended (a clocked-out break).
	 */
	readonly minutes: number;
	/** Whether only the rest of a running shift counts, its recorded work the time so far. */
	readonly inProgress: boolean;
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
	 * Whether some short-term terms of the year plan no real week of the employee's own: a schedule
	 * from published shifts or on-call terms, a week only inherited from a team or organization
	 * default, or weekly hours alone (which the resolver spreads Monday–Friday).
	 */
	readonly unplannedTerms: boolean;
	/** Counted days (`YYYY-MM-DD`, sorted, distinct) under such terms: their week is read from them. */
	readonly unplannedDays: readonly string[];
}

/**
 * One short-term employment: confirmed short-term terms of one employment period that follow each
 * other without a gap (a new wage or week does not end the employment), as in force after
 * supersession by later confirmed terms.
 */
export interface ShortTermEmployment {
	/** First day, `YYYY-MM-DD`. */
	readonly from: string;
	/** Day after the last, `YYYY-MM-DD`; null while the terms run on. */
	readonly until: string | null;
	/**
	 * Whether its terms were agreed with a fixed end: then the employment runs from its first day
	 * through its pauses. Open-ended framework terms only last while the employee works.
	 */
	readonly fixedTerm: boolean;
}

export interface ShortTermEmployeeInputs {
	readonly employeeId: string;
	readonly work: readonly ShortTermWorkItem[];
	readonly planned: readonly ShortTermPlanItem[];
	readonly priorOffsets: readonly ShortTermPriorOffset[];
	/** The employee's short-term employments overlapping the requested years, by first day. */
	readonly employments: readonly ShortTermEmployment[];
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

/** Whether a resolved field was set for the employee rather than inherited from a default. */
function setForEmployee(source: ContractFieldSource): boolean {
	return source === "employee_term" || source === "employee_override";
}

/**
 * Whether the employee's own terms plan real week days: custom days on their terms or an active
 * schedule of a work policy assigned to them. A week inherited from a team or organization
 * default is not their agreed week (a Saturday helper under a Monday–Friday default works one
 * day), and weekly hours alone are not a week: the resolver spreads them Monday–Friday.
 */
function plansRealWeek(contract: EffectiveContractOnDay): boolean {
	if (contract.scheduleSource !== "policy") return false;
	if (contract.scheduleMode === "custom_days") {
		return (
			setForEmployee(contract.scheduleModeSource) &&
			contract.weeklyScheduleDays.some((day) => day.isWorkDay)
		);
	}
	return (
		setForEmployee(contract.workPolicySource) &&
		Boolean(contract.workPolicy?.scheduleEnabled && contract.workPolicy.schedule)
	);
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

/** The start of `instant`'s minute: open work and the rest of its shift meet on this grid. */
function minuteGrid(instant: Instant): Instant {
	return instant.round({ smallestUnit: "minute", roundingMode: "floor" });
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

interface TermsRow {
	readonly id: string;
	readonly employmentPeriodId: string | null;
	readonly employmentProfile: string | null;
	readonly validFromDate: string;
	readonly validUntilDate: string | null;
	readonly createdAt: Date;
}

/**
 * An employee's short-term employments from their confirmed terms rows (any profile). As in the
 * contract resolver, within one employment period a later row cuts the end of the row before
 * it; short-term rows that then meet form one employment.
 */
export function shortTermEmployments(rows: readonly TermsRow[]): ShortTermEmployment[] {
	const employments: ShortTermEmployment[] = [];
	for (const group of groupBy(rows, (row) => row.employmentPeriodId ?? "").values()) {
		const ordered = [...group]
			.filter((row) => row.validUntilDate === null || row.validFromDate < row.validUntilDate)
			.sort(
				(a, b) =>
					a.validFromDate.localeCompare(b.validFromDate) ||
					a.createdAt.getTime() - b.createdAt.getTime() ||
					a.id.localeCompare(b.id),
			);
		let current: { from: string; until: string | null; fixedTerm: boolean } | null = null;
		for (const [index, row] of ordered.entries()) {
			const next = ordered[index + 1];
			const until =
				next && (row.validUntilDate === null || next.validFromDate < row.validUntilDate)
					? next.validFromDate
					: row.validUntilDate;
			if (until !== null && row.validFromDate >= until) continue;
			if (row.employmentProfile !== "short_term") {
				if (current) employments.push(current);
				current = null;
				continue;
			}
			const fixedTerm = row.validUntilDate !== null;
			if (current && current.until === row.validFromDate) {
				current.until = until;
				current.fixedTerm = fixedTerm;
			} else {
				if (current) employments.push(current);
				current = { from: row.validFromDate, until, fixedTerm };
			}
		}
		if (current) employments.push(current);
	}
	return employments.sort((a, b) => a.from.localeCompare(b.from));
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
		/** Shifts that have not ended by this instant are planned work; open clock-ins run to it. */
		readonly now: Instant;
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

	// Confirmed terms of every profile in the years: later terms cut short-term ones. Cheap
	// pre-filter: only employees with confirmed short-term terms in the years matter.
	const confirmedTermRows = await db
		.select({
			id: employeeEmploymentHistory.id,
			employeeId: employeeEmploymentHistory.employeeId,
			employmentPeriodId: employeeEmploymentHistory.employmentPeriodId,
			employmentProfile: employeeEmploymentHistory.employmentProfile,
			validFromDate: employeeEmploymentHistory.validFromDate,
			validUntilDate: employeeEmploymentHistory.validUntilDate,
			createdAt: employeeEmploymentHistory.createdAt,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				inArray(employeeEmploymentHistory.employeeId, [...new Set(input.employeeIds)]),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lt(employeeEmploymentHistory.validFromDate, until),
				or(
					isNull(employeeEmploymentHistory.validUntilDate),
					gt(employeeEmploymentHistory.validUntilDate, from),
				),
			),
		);
	const termRows = confirmedTermRows.filter((row) => row.employmentProfile === "short_term");
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

	// Work and shifts just outside the years too: work belonging to a shift counts on the shift's
	// date (a clock-in at 23:50 on 31 December for a shift on 1 January counts in the new year).
	const yearStart = dateFromInstant(
		localDayRange(from, input.timezone).start.subtract({
			minutes: SHIFT_WORK_ASSOCIATION_LEAD_MINUTES,
		}),
	);
	const yearEnd = dateFromInstant(localDayRange(until, input.timezone).start);
	const workRows = await db
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isActive: workPeriod.isActive,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, candidates),
				or(
					completedWorkPeriodCondition(),
					// Open clock-ins: running work counts up to now.
					and(eq(workPeriod.isActive, true), isNull(workPeriod.deletedAt)),
				),
				gte(workPeriod.startTime, yearStart),
				lt(workPeriod.startTime, yearEnd),
			),
		);

	const shiftBounds = shiftDateRangeBounds(
		parsePlainDate(from).subtract({ days: 1 }).toString(),
		parsePlainDate(until).add({ days: 1 }).toString(),
		input.timezone,
	);
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
	// Running work and the rest of its shift meet on one minute grid, so their sum stays put
	// whatever seconds the clock-in or the evaluation instant carry.
	const nowOnGrid = minuteGrid(input.now);
	type RecordedWork = Pick<ShortTermWorkItem, "minutes"> & {
		readonly id: string;
		readonly start: Instant;
		/** Null while the clock-in is open. */
		readonly end: Instant | null;
	};
	const recordedByEmployee = new Map<string, RecordedWork[]>();
	for (const row of workRows) {
		const start = instantFromDate(row.startTime);
		const open = row.isActive && row.endTime === null;
		const end = open
			? null
			: row.endTime
				? instantFromDate(row.endTime)
				: start.add({ minutes: row.durationMinutes ?? 0 });
		const item: RecordedWork = {
			id: row.id,
			start,
			end,
			// Whole grid minutes, so far while open: with the rest of its shift from the same grid
			// minute, the sum stays put, and clocking out keeps the minutes counted while it ran
			// (the stored duration rounds the exact length, which moves a clock-in with seconds).
			minutes: Math.max(
				0,
				end
					? row.endTime
						? minuteGrid(start).until(minuteGrid(end)).total("minutes")
						: (row.durationMinutes ?? 0)
					: minuteGrid(start).until(nowOnGrid).total("minutes"),
			),
		};
		const list = recordedByEmployee.get(row.employeeId);
		if (list) list.push(item);
		else recordedByEmployee.set(row.employeeId, [item]);
	}
	interface LoadedShift {
		readonly id: string;
		readonly date: string;
		readonly startTime: string;
		readonly endTime: string;
		readonly interval: ShiftInterval;
	}
	const shiftsByEmployee = new Map<string, LoadedShift[]>();
	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const date = shiftCalendarDate(row.date, input.timezone);
		const loaded: LoadedShift = {
			id: row.id,
			date: date.toString(),
			startTime: row.startTime,
			endTime: row.endTime,
			interval: shiftInterval(
				{ date, startTime: row.startTime, endTime: row.endTime },
				input.timezone,
			),
		};
		const list = shiftsByEmployee.get(row.employeeId);
		if (list) list.push(loaded);
		else shiftsByEmployee.set(row.employeeId, [loaded]);
	}

	/** Recorded work dated by the shift it belongs to, split at shift starts (see the matching). */
	type DatedWork = RecordedWork & {
		readonly date: string;
		readonly inProgress: ShortTermWorkItem["inProgress"];
	};
	const workByEmployee = new Map<string, DatedWork[]>();
	type PlannedShift = Pick<
		ShortTermPlanItem,
		"shiftId" | "date" | "startTime" | "endTime" | "minutes" | "inProgress"
	>;
	const plannedByEmployee = new Map<string, PlannedShift[]>();
	for (const employeeId of candidates) {
		const recorded = recordedByEmployee.get(employeeId) ?? [];
		const shifts = shiftsByEmployee.get(employeeId) ?? [];
		const shiftsOfWork = matchWorkToShifts(shifts, recorded, input.now);
		/** Shift → the work belonging to it; an open clock-in only to the shift it is running for. */
		const workOfShift = new Map<string, RecordedWork[]>();
		/**
		 * Open clock-in → the shift whose rest is counted with it: the first it belongs to that has
		 * not ended (a clock-in at 23:50 for a shift from midnight too). One clock-in never stands
		 * for the rest of two shifts.
		 */
		const runningShiftOf = new Map<string, LoadedShift>();
		for (const [work, belongs] of shiftsOfWork) {
			const running =
				work.end === null
					? belongs.find((s) => compareInstants(s.interval.end, input.now) > 0)
					: undefined;
			if (running) runningShiftOf.set(work.id, running);
			for (const s of belongs) {
				if (work.end === null && s !== running) continue;
				const list = workOfShift.get(s.id);
				if (list) list.push(work);
				else workOfShift.set(s.id, [work]);
			}
		}

		const dated: DatedWork[] = [];
		for (const work of recorded) {
			const running = runningShiftOf.get(work.id);
			const inProgress: DatedWork["inProgress"] =
				work.end !== null ? null : running ? { shiftId: running.id } : "unplanned";
			const belongs = shiftsOfWork.get(work);
			const parts = belongs
				? splitWorkAtShiftStarts(work, belongs, input.now, minuteGrid).map((part) => ({
						date: part.shift.date,
						minutes: part.minutes,
					}))
				: [{ date: plainDateAt(work.start, input.timezone).toString(), minutes: work.minutes }];
			for (const part of parts) {
				if (inYears(part.date)) dated.push({ ...work, ...part, inProgress });
			}
		}
		workByEmployee.set(employeeId, dated);

		const planned: PlannedShift[] = [];
		for (const s of shifts) {
			if (!inYears(s.date)) continue;
			// Over: what was worked is recorded work.
			if (compareInstants(s.interval.end, input.now) <= 0) continue;
			const item = { shiftId: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime };
			const matched = workOfShift.get(s.id) ?? [];
			const started = compareInstants(s.interval.start, input.now) <= 0;
			const open = matched.some((work) => work.end === null);
			// Not started and nobody clocked in for it, or running and nobody clocked in yet: in full.
			if (matched.length === 0 || (!started && !open)) {
				planned.push({ ...item, minutes: shiftMinutes(s.interval), inProgress: false });
				continue;
			}
			// An open clock-in counts up to now and the shift for its rest from now, also when it
			// started early for a shift still ahead. During a clocked-out break, the rest counts from
			// the end of the work recorded for it, so nothing moves until the shift ends or work
			// resumes.
			let lastEnd = s.interval.start;
			for (const work of matched) {
				if (work.end !== null && compareInstants(work.end, lastEnd) > 0) lastEnd = work.end;
			}
			const restStart = open ? nowOnGrid : minuteGrid(lastEnd);
			planned.push({
				...item,
				minutes: Math.max(0, restStart.until(s.interval.end).total("minutes")),
				inProgress: true,
			});
		}
		plannedByEmployee.set(employeeId, planned);
	}
	const addPlanned = (employeeId: string, item: PlannedShift) => {
		const list = plannedByEmployee.get(employeeId);
		if (list) list.push(item);
		else plannedByEmployee.set(employeeId, [item]);
	};
	const inScope = new Set(candidates);
	for (const proposed of input.proposedShifts) {
		if (!inScope.has(proposed.employeeId) || !inYears(proposed.date)) continue;
		const interval = shiftInterval(
			{
				date: parsePlainDate(proposed.date),
				startTime: proposed.startTime,
				endTime: proposed.endTime,
			},
			input.timezone,
		);
		addPlanned(proposed.employeeId, {
			shiftId: null,
			date: proposed.date,
			startTime: proposed.startTime,
			endTime: proposed.endTime,
			minutes: shiftMinutes(interval),
			inProgress: false,
		});
	}

	const termRowsByEmployee = groupBy(termRows, (row) => row.employeeId);
	const confirmedTermRowsByEmployee = groupBy(confirmedTermRows, (row) => row.employeeId);
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
				inProgress: item.inProgress,
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
			employments: shortTermEmployments(confirmedTermRowsByEmployee.get(employeeId) ?? []),
			weekByYear,
		});
	}
	return { employees, thresholds };
}
