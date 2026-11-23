/**
 * Everything the § 12 TzBfG on-call monitor reads, loaded once per evaluation and batched across
 * employees: who is on call on which day (confirmed terms through the contract resolver), their
 * shifts (draft and published), their work per organization-local day and per call (a running
 * clock-in counts up to now) and the on-call baselines. Read-only: `select` only.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { employeeEmploymentHistory, shift, workPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { ResolvedOnCallTerms } from "@/lib/contracts/types";
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { loadStatutoryThresholds, type StatutoryThresholdTable } from "../thresholds";

export type OnCallReader = Pick<DatabaseClient, "select">;

export const ON_CALL_THRESHOLD_KEYS = [
	"de_on_call_notice_full_days",
	"de_on_call_min_call_minutes",
	"de_on_call_default_weekly_minutes",
	"de_on_call_min_band_plus_pct",
	"de_on_call_max_band_minus_pct",
] as const;

/** A persisted or proposed shift of an on-call employee, read in the organization's zone. */
export interface OnCallShift {
	/** Null for a Staffing proposal. */
	readonly id: string | null;
	readonly employeeId: string;
	readonly date: PlainDate;
	readonly startTime: string;
	readonly endTime: string;
	readonly minutes: number;
	readonly status: "draft" | "published";
	readonly publishedAt: Instant | null;
	readonly assignmentChangedAt: Instant | null;
}

/**
 * One call as worked (§ 12 Abs. 1 Satz 4 TzBfG): one contiguous deployment, i.e. a work period or
 * work periods joined only by breaks.
 */
export interface OnCallWorkCall {
	/** Organization-local day the call started. */
	readonly day: PlainDate;
	/** Organization-local wall time the call started, `HH:MM`. */
	readonly startTime: string;
	/** Worked minutes; a running clock-in counts up to now. */
	readonly minutes: number;
	/** True while the call has a running clock-in: it is not over and cannot be judged yet. */
	readonly inProgress: boolean;
}

/**
 * The longest gap between two work periods that is still a break inside one call. A longer gap
 * starts a new call, unless both periods fall within the same planned shift.
 */
export const ON_CALL_MAX_BREAK_MINUTES = 60;

export interface OnCallFacts {
	readonly thresholds: StatutoryThresholdTable;
	/** Employees on call on at least one loaded day, with their terms per day (`YYYY-MM-DD`). */
	readonly termsByEmployee: ReadonlyMap<string, ReadonlyMap<string, ResolvedOnCallTerms>>;
	readonly shiftsByEmployee: ReadonlyMap<string, readonly OnCallShift[]>;
	/** Worked minutes per organization-local start day; a running clock-in counts up to now. */
	readonly workMinutesByEmployee: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/** Worked calls in start order. */
	readonly workCallsByEmployee: ReadonlyMap<string, readonly OnCallWorkCall[]>;
}

export function daysOf(from: PlainDate, untilExclusive: PlainDate): PlainDate[] {
	const days: PlainDate[] = [];
	for (let day = from; comparePlainDates(day, untilExclusive) < 0; day = day.add({ days: 1 })) {
		days.push(day);
	}
	return days;
}

export function shiftMinutes(
	input: { date: PlainDate; startTime: string; endTime: string },
	timezone: string,
): number {
	const interval = shiftInterval(input, timezone);
	return Math.round(interval.start.until(interval.end).total("minutes"));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/**
 * Loads the on-call facts of `[from, untilExclusive)`. `employeeIds` narrows the employees (null:
 * every employee of the organization with confirmed on-call terms in the range).
 */
export async function loadOnCallFacts(
	db: OnCallReader,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		readonly from: PlainDate;
		readonly untilExclusive: PlainDate;
		readonly employeeIds: readonly string[] | null;
		readonly replacesShiftId: string | null;
		/** A running clock-in counts up to this instant. */
		readonly now: Instant;
	},
): Promise<OnCallFacts> {
	const from = input.from.toString();
	const until = input.untilExclusive.toString();
	const thresholds = await loadStatutoryThresholds(db, {
		keys: ON_CALL_THRESHOLD_KEYS,
		from,
		until,
	});
	const empty: OnCallFacts = {
		thresholds,
		termsByEmployee: new Map(),
		shiftsByEmployee: new Map(),
		workMinutesByEmployee: new Map(),
		workCallsByEmployee: new Map(),
	};
	if (input.employeeIds?.length === 0) return empty;

	// Narrow to employees with confirmed on-call terms overlapping the range before resolving days.
	const candidates = await db
		.select({ employeeId: employeeEmploymentHistory.employeeId })
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.scheduleSource, "on_call"),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lt(employeeEmploymentHistory.validFromDate, until),
				or(
					isNull(employeeEmploymentHistory.validUntilDate),
					gt(employeeEmploymentHistory.validUntilDate, from),
				),
				input.employeeIds
					? inArray(employeeEmploymentHistory.employeeId, [...input.employeeIds])
					: undefined,
			),
		);
	const candidateIds = [...new Set(candidates.map((row) => row.employeeId))].toSorted();
	if (candidateIds.length === 0) return empty;

	const days = daysOf(input.from, input.untilExclusive);
	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: candidateIds,
		dates: days,
		// On-call weeks and days are the organization's calendar, as in Scheduling.
		timezoneOverride: input.timezone,
		organizationTimezone: input.timezone,
	});
	const termsByEmployee = new Map<string, Map<string, ResolvedOnCallTerms>>();
	for (const [employeeId, byDay] of contracts) {
		for (const [day, contract] of byDay) {
			if (!contract.isEmployedOnDay || !contract.onCallTerms) continue;
			const terms = termsByEmployee.get(employeeId) ?? new Map<string, ResolvedOnCallTerms>();
			terms.set(day, contract.onCallTerms);
			termsByEmployee.set(employeeId, terms);
		}
	}
	const onCallIds = [...termsByEmployee.keys()].toSorted();
	if (onCallIds.length === 0) return empty;

	const bounds = shiftDateRangeBounds(input.from, input.untilExclusive, input.timezone);
	const shiftRows = await db
		.select({
			id: shift.id,
			employeeId: shift.employeeId,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
			status: shift.status,
			publishedAt: shift.publishedAt,
			assignmentChangedAt: shift.assignmentChangedAt,
		})
		.from(shift)
		.where(
			and(
				eq(shift.organizationId, input.organizationId),
				inArray(shift.employeeId, onCallIds),
				gte(shift.date, bounds.start),
				lt(shift.date, bounds.endExclusive),
				input.replacesShiftId ? ne(shift.id, input.replacesShiftId) : undefined,
			),
		);
	const shiftsByEmployee = new Map<string, OnCallShift[]>();
	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const date = shiftCalendarDate(row.date, input.timezone);
		push(shiftsByEmployee, row.employeeId, {
			id: row.id,
			employeeId: row.employeeId,
			date,
			startTime: row.startTime,
			endTime: row.endTime,
			minutes: shiftMinutes(
				{ date, startTime: row.startTime, endTime: row.endTime },
				input.timezone,
			),
			status: row.status,
			publishedAt: row.publishedAt ? instantFromDate(row.publishedAt) : null,
			assignmentChangedAt: instantFromDate(row.assignmentChangedAt),
		});
	}
	for (const list of shiftsByEmployee.values()) {
		list.sort(
			(a, b) =>
				comparePlainDates(a.date, b.date) ||
				a.startTime.localeCompare(b.startTime) ||
				(a.id ?? "").localeCompare(b.id ?? ""),
		);
	}

	const workRows = await db
		.select({
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
				inArray(workPeriod.employeeId, onCallIds),
				// Completed work, and a running clock-in: work in progress must not vanish.
				or(
					and(completedWorkPeriodCondition(), isNotNull(workPeriod.endTime)),
					and(eq(workPeriod.isActive, true), isNull(workPeriod.deletedAt)),
				),
				gte(workPeriod.startTime, bounds.start),
				lt(workPeriod.startTime, bounds.endExclusive),
			),
		);
	const piecesByEmployee = new Map<string, WorkPiece[]>();
	for (const row of workRows) {
		const start = instantFromDate(row.startTime);
		const running = row.isActive || !row.endTime;
		const end = !row.isActive && row.endTime ? instantFromDate(row.endTime) : input.now;
		if (compareInstants(end, start) < 0) continue;
		const minutes = running
			? Math.floor(start.until(end).total("minutes"))
			: (row.durationMinutes ?? Math.round(start.until(end).total("minutes")));
		push(piecesByEmployee, row.employeeId, { start, end, minutes, running });
	}

	const workMinutesByEmployee = new Map<string, Map<string, number>>();
	const workCallsByEmployee = new Map<string, OnCallWorkCall[]>();
	for (const [employeeId, pieces] of piecesByEmployee) {
		const byDay = new Map<string, number>();
		for (const piece of pieces) {
			// Work counts on its organization-local start day, as Scheduling buckets work.
			const day = plainDateAt(piece.start, input.timezone).toString();
			byDay.set(day, (byDay.get(day) ?? 0) + piece.minutes);
		}
		workMinutesByEmployee.set(employeeId, byDay);
		workCallsByEmployee.set(
			employeeId,
			workCalls(pieces, shiftsByEmployee.get(employeeId) ?? [], input.timezone),
		);
	}

	return {
		thresholds,
		termsByEmployee,
		shiftsByEmployee,
		workMinutesByEmployee,
		workCallsByEmployee,
	};
}

interface WorkPiece {
	readonly start: Instant;
	readonly end: Instant;
	readonly minutes: number;
	readonly running: boolean;
}

/** Joins an employee's work periods into calls: periods separated only by breaks are one call. */
function workCalls(
	pieces: readonly WorkPiece[],
	shifts: readonly OnCallShift[],
	timezone: string,
): OnCallWorkCall[] {
	const shiftIntervals = shifts.map((s) => shiftInterval(s, timezone));
	const shiftsOf = (piece: WorkPiece) =>
		shiftIntervals.filter(
			(interval) =>
				compareInstants(piece.start, interval.end) < 0 &&
				compareInstants(piece.end, interval.start) > 0,
		);
	const sorted = pieces.toSorted((a, b) => compareInstants(a.start, b.start));
	const calls: OnCallWorkCall[] = [];
	let current: { first: WorkPiece; end: Instant; minutes: number; running: boolean } | null = null;
	let currentShifts = new Set<(typeof shiftIntervals)[number]>();
	const close = () => {
		if (!current) return;
		const local = current.first.start.toZonedDateTimeISO(timezone);
		calls.push({
			day: local.toPlainDate(),
			startTime: local.toPlainTime().toString({ smallestUnit: "minute" }),
			minutes: current.minutes,
			inProgress: current.running,
		});
	};
	for (const piece of sorted) {
		const pieceShifts = shiftsOf(piece);
		const gapMinutes = current ? current.end.until(piece.start).total("minutes") : 0;
		const sameShift = pieceShifts.some((interval) => currentShifts.has(interval));
		if (current && (gapMinutes <= ON_CALL_MAX_BREAK_MINUTES || sameShift)) {
			current.minutes += piece.minutes;
			current.running ||= piece.running;
			if (compareInstants(piece.end, current.end) > 0) current.end = piece.end;
			for (const interval of pieceShifts) currentShifts.add(interval);
			continue;
		}
		close();
		current = { first: piece, end: piece.end, minutes: piece.minutes, running: piece.running };
		currentShifts = new Set(pieceShifts);
	}
	close();
	return calls;
}
